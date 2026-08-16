import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { env } from './lib/env'
import { registerRoutes } from './routes'

export interface BuildAppOptions {
  logger?: boolean
  jwtSecret?: string
  rateLimitMax?: number
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    logger: opts.logger ?? true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  })

  // TODO(security): ganti `origin: true` dengan whitelist domain Vercel (lihat docs/SECURITY.md)
  await app.register(cors, { origin: true })

  await app.register(jwt, { secret: opts.jwtSecret ?? env.JWT_SECRET })

  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? 120,
    timeWindow: '1 minute',
  })

  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))

  registerRoutes(app)

  return app
}
