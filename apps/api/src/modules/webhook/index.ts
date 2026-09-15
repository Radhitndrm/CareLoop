import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import {
  verifyHubChallenge,
  processWebhookMessage,
} from './webhook.service'

export function registerWebhookRoutes(app: FastifyInstance): void {
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body.toString('utf8')))
      } catch (err) {
        done(err as Error)
      }
    })

    scoped.get('/webhooks/whatsapp', async (req, reply) => {
      const query = req.query as Record<string, string | undefined>
      if (query['hub.mode'] !== 'subscribe') {
        return reply.code(403).send({ error: { code: 'WEBHOOK_MODE_INVALID', message: 'Mode tidak valid' } })
      }
      if (!verifyHubChallenge(query['hub.verify_token'], process.env.WA_WEBHOOK_VERIFY_TOKEN)) {
        return reply.code(403).send({ error: { code: 'WEBHOOK_VERIFY_TOKEN_INVALID', message: 'Verify token tidak cocok' } })
      }
      return reply.code(200).type('text/plain').send(query['hub.challenge'] ?? '')
    })

    scoped.post('/webhooks/whatsapp', async (req, reply) => {
      const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined
      if (!rawBody) {
        return reply.code(401).send({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Raw body tidak tersedia' } })
      }

      const secret = process.env.WA_APP_SECRET
      if (!secret) {
        return reply.code(500).send({ error: { code: 'WEBHOOK_SECRET_MISSING', message: 'WA_APP_SECRET belum dikonfigurasi' } })
      }

      const signature = Array.isArray(req.headers['x-hub-signature-256'])
        ? req.headers['x-hub-signature-256'][0]
        : req.headers['x-hub-signature-256']

      try {
        const result = await processWebhookMessage(prisma, rawBody, signature, secret)
        return reply.code(200).send({ data: result })
      } catch (err: unknown) {
        const error = err as { statusCode?: number; code?: string; message?: string }
        const statusCode = error.statusCode ?? 500
        return reply.code(statusCode).send({
          error: {
            code: error.code ?? 'WEBHOOK_ERROR',
            message: error.message ?? 'Terjadi kesalahan',
          },
        })
      }
    })
  })
}
