import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { env } from './lib/env'
import { registerErrorHandler } from './lib/errors'
import { registerRoutes } from './routes'

export interface BuildAppOptions {
  logger?: boolean
  jwtSecret?: string
  rateLimitMax?: number
  corsOrigins?: string[]
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
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

  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))

  registerRoutes(app)

  return app
}
