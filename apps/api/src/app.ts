import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { getEnv } from './lib/env'
import { registerErrorHandler } from './lib/errors'
import { registerHealthRoutes } from './lib/health'
import { closeRedis } from './lib/redis'
import { registerRoutes } from './routes'

import { createDashboardWsServer, getDashboardWsServer, setDashboardWsServer } from './modules/dashboard/ws'
import { registerEscalationScheduler } from './modules/escalation/escalation.scheduler'
import { registerPharmacyScheduler } from './modules/pharmacy/pharmacy.scheduler'
import { registerReminderScheduler } from './modules/reminders/reminder.scheduler'

export interface BuildAppOptions {
  logger?: boolean
  jwtSecret?: string
  rateLimitMax?: number
  corsOrigins?: string[]
  enableWs?: boolean
  /**
   * Scheduler permintaan rutin farmasi. Default MATI dan diaktifkan eksplisit
   * oleh bootstrap di src/index.ts — supaya test yang memanggil buildApp()
   * tidak suddenly membuat request obat di database test.
   */
  enablePharmacyScheduler?: boolean
  /**
   * Dispatcher reminder (memindai jadwal -> job WhatsApp). Default MATI dan diaktifkan
   * eksplisit oleh bootstrap di src/index.ts — test yang memanggil buildApp() tidak
   * boleh diam-diam mengirim pesan ke nomor patients.
   */
  enableReminderScheduler?: boolean
  /**
   * Reconciler timeout eskalasi (WAITING_PATIENT -> keluarga tier 1/2 -> nakes).
   * Default MATI dengan alasan yang sama seperti scheduler di atas.
   */
  enableEscalationScheduler?: boolean
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = getEnv()

  const app: FastifyInstance = Fastify({
    logger: opts.logger ?? true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  })

  // Whitelist domain frontend dari CORS_ORIGINS; kosong hanya boleh di luar production
  // (env.ts menolak startup production tanpa whitelist). Lihat docs/SECURITY.md.
  const corsOrigins = opts.corsOrigins ?? env.CORS_ORIGINS
  await app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : true })

  await app.register(jwt, { secret: opts.jwtSecret ?? env.JWT_SECRET })

  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  })

  registerErrorHandler(app)

  // `/healthz` (liveness) tidak menyentuh dependency; `/readyz` memeriksa database,
  // Redis, dan versi migration. Penjelasan pemisahan ada di lib/health.ts.
  registerHealthRoutes(app)

  registerRoutes(app)

  if (opts.enableWs !== false) {
    let ioInstance: ReturnType<typeof createDashboardWsServer> | null = null

    app.addHook('onReady', async () => {
      if (!getDashboardWsServer()) {
        ioInstance = createDashboardWsServer(app.server, {
          jwtSecret: opts.jwtSecret ?? env.JWT_SECRET,
          corsOrigin: corsOrigins.length > 0 ? corsOrigins : true,
        })
      }
    })

    app.addHook('onClose', async () => {
      const io = ioInstance ?? getDashboardWsServer()
      if (io) {
        await new Promise<void>((resolve) => {
          io.close(() => resolve())
        })
        if (getDashboardWsServer() === io) {
          setDashboardWsServer(null)
        }
      }
    })
  }

  if (opts.enablePharmacyScheduler === true) {
    registerPharmacyScheduler(app)
  }

  if (opts.enableReminderScheduler === true) {
    registerReminderScheduler(app)
  }

  if (opts.enableEscalationScheduler === true) {
    registerEscalationScheduler(app)
  }

  // Koneksi Redis (OTP store) ikut ditutup supaya `docker stop`/deploy tidak
  // menggantung di socket yang masih terbuka.
  app.addHook('onClose', async () => {
    await closeRedis()
  })

  return app
}
