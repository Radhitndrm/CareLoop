// WhatsApp Simulator — endpoint demo untuk presentasi (plan tasks/plan-whatsapp-mockup-demo.md).
//
// Tiga lapis guard, semuanya wajib:
//   1. `SIMULATOR_ENABLED` — env validation sudah menolak production yang menyalakannya,
//      dan `assertSimulatorEnabled` menutup route kalau env-nya dimanipulasi saat runtime.
//   2. `authenticate` — tidak ada satu pun endpoint di sini yang terbuka (AGENTS.md §2.8).
//   3. `requireCareTeamRole` — apotek (FARMASI) dikecualikan: panel ini menampilkan nomor
//      HP dan isi pesan pasien, sedangkan apotek hanya berhak menyentuh antrean obat
//      (AGENTS.md §2.7).
//
// Route di sini tidak pernah mengubah status domain langsung: reply diproses lewat
// `dispatchWaIntent`, pemicu scenario lewat service produksi yang sama dengan scheduler.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AuditAction } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireCareTeamRole } from '../../lib/auth'
import { getEnv } from '../../lib/env'
import { notFound } from '../../lib/errors'
import { tryCreateAuditLog } from '../../lib/audit'
import {
  getWhatsAppSandbox,
  parseButtonReply,
  type SandboxMessage,
} from '../../integrations/whatsapp'
import { getReminderJobQueue } from '../reminders/reminder.queue'
import { dispatchWaIntent, type WaIntent } from '../wa-intents'
import {
  hasProviderFailure,
  isSimulatorScenario,
  resetSimulator,
  runHeartRateAnomalyScenario,
  runProviderFailureScenario,
  runReminderConfirmedScenario,
  runReminderNoResponseScenario,
  setProviderFailureSimulation,
  SIMULATOR_SCENARIOS,
  DEMO_SCENARIO_DEFAULTS,
  type SimulatorScenario,
} from './scenarios.service'
import {
  loadRecipientDirectory,
  toMessageView,
  type RecipientRef,
  type SimulatorMessageView,
  type SimulatorThreadView,
} from './sandbox.service'

const SIMULATOR_GUARDS = [authenticate, requireCareTeamRole()]

/** Route dev tidak pernah ada di produksi — 404, bukan 403, supaya tidak bisa dipetakan. */
function assertSimulatorEnabled(): void {
  let enabled = false
  try {
    enabled = getEnv().SIMULATOR_ENABLED
  } catch {
    enabled = false
  }
  if (!enabled) {
    throw notFound('Route simulator tidak ada')
  }
}

function unknownRecipient(phone: string): RecipientRef {
  return {
    phone,
    displayPhone: phone,
    kind: 'UNKNOWN',
    label: 'Nomor tidak dikenal',
    patientId: null,
  }
}

async function buildThreads(): Promise<SimulatorThreadView[]> {
  const sandbox = getWhatsAppSandbox()
  const raw = sandbox.threads()
  const directory = await loadRecipientDirectory(prisma, raw.map((t) => t.to))

  return raw.map((thread) => ({
    recipient: directory.get(thread.to) ?? unknownRecipient(thread.to),
    messageCount: thread.messageCount,
    lastMessageAt: thread.lastMessageAt,
    hasUnanswered: thread.hasUnanswered,
  }))
}

function toViews(messages: readonly SandboxMessage[]): SimulatorMessageView[] {
  return messages.map(toMessageView)
}

const scenarioParamsSchema = z.object({ scenario: z.string().min(1) })
const triggerBodySchema = z.object({
  scheduleId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
})
const replyBodySchema = z.object({
  buttonId: z.string().min(1).max(256),
})
const querySchema = z.object({
  to: z.string().min(6).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export function registerSimulatorRoutes(app: FastifyInstance): void {
  // GET /v1/dev/whatsapp/status — apakah simulator boleh dipakai di instance ini.
  app.get('/v1/dev/whatsapp/status', { preHandler: SIMULATOR_GUARDS }, async (req, reply) => {
    assertSimulatorEnabled()
    const env = getEnv()
    const claims = getAuthUser(req)

    return reply.code(200).send({
      data: {
        enabled: true,
        providerMode: env.PROVIDER_MODE,
        nodeEnv: env.NODE_ENV,
        scenarios: SIMULATOR_SCENARIOS,
        defaults: DEMO_SCENARIO_DEFAULTS,
        providerFailureSimulated: hasProviderFailure(),
        actor: { sub: claims.sub, role: claims.role },
      },
    })
  })

  // GET /v1/dev/whatsapp/threads — daftar percakapan per penerima.
  app.get('/v1/dev/whatsapp/threads', { preHandler: SIMULATOR_GUARDS }, async (_req, reply) => {
    assertSimulatorEnabled()
    return reply.code(200).send({ data: await buildThreads() })
  })

  // GET /v1/dev/whatsapp/messages — isi percakapan, boleh difilter per nomor.
  app.get<{ Querystring: Record<string, string> }>(
    '/v1/dev/whatsapp/messages',
    { preHandler: SIMULATOR_GUARDS },
    async (req, reply) => {
      assertSimulatorEnabled()
      const query = querySchema.parse(req.query ?? {})
      const sandbox = getWhatsAppSandbox()

      const messages = sandbox.list({ to: query.to, limit: query.limit })
      const directory = await loadRecipientDirectory(prisma, messages.map((m) => m.to))

      const to = query.to ?? messages[0]?.to ?? null
      return reply.code(200).send({
        data: toViews(messages),
        meta: {
          to,
          recipient: to ? (directory.get(to) ?? unknownRecipient(to)) : null,
          total: messages.length,
        },
      })
    },
  )

  // POST /v1/dev/whatsapp/messages/:messageId/reply — presenter menekan tombol.
  //
  // Balasan diproses sebagai balasan WhatsApp sungguhan: id tombol di-parse jadi
  // intent + resource, lalu `dispatchWaIntent` memeriksa apakah nomor itu berhak atas
  // resource tersebut sebelum menyentuh domain.
  app.post<{ Params: { messageId: string } }>(
    '/v1/dev/whatsapp/messages/:messageId/reply',
    { preHandler: SIMULATOR_GUARDS },
    async (req, reply) => {
      assertSimulatorEnabled()
      const { messageId } = z.object({ messageId: z.string().min(1) }).parse(req.params)
      const body = replyBodySchema.parse(req.body ?? {})

      const sandbox = getWhatsAppSandbox()
      const message = sandbox.get(messageId)
      if (!message) throw notFound(`Pesan ${messageId} tidak ada di simulator`)

      const parsed = parseButtonReply(body.buttonId)
      if (!parsed) {
        throw notFound(`Tombol ${body.buttonId} bukan tombol balasan yang bisa diproses`)
      }

      // Tombol harus benar-benar milik pesan yang sedang ditekan presenter.
      const ownsButton = message.buttons.some((b) => b.id === body.buttonId)
      if (!ownsButton) {
        throw notFound(`Tombol ${body.buttonId} bukan bagian dari pesan ${messageId}`)
      }

      // Idempotensi level UI: tombol yang sudah dibalas tidak boleh ditekan dua kali.
      if (message.answeredAt !== null) {
        throw notFound('Tombol ini sudah dipakai — pesan sudah dibalas')
      }

      const claims = getAuthUser(req)
      const inbound = sandbox.recordInbound({
        to: message.to,
        from: message.to,
        body: buttonTitle(message, body.buttonId),
      })
      sandbox.markThreadReadBefore(message.to, inbound.createdAt, inbound.messageId)

      const result = await dispatchWaIntent(
        { prisma, reminderQueue: getReminderJobQueue() },
        {
          intent: parsed.intent as WaIntent,
          resourceId: parsed.resourceId,
          actorPhone: message.to,
          sourceMessageId: message.providerMessageId,
          notes: `Simulator (${claims.role}): ${claims.sub}`,
        },
      )

      await tryCreateAuditLog(prisma as any, {
        action: AuditAction.SIMULATOR_REPLIED,
        actorUserId: claims.sub,
        actorRole: claims.role,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        meta: {
          messageId,
          buttonId: body.buttonId,
          intent: result.intent,
          outcome: result.outcome,
        },
      })

      return reply.code(200).send({
        data: {
          inboundMessageId: inbound.messageId,
          intent: result.intent,
          resourceType: result.resourceType,
          resourceId: result.resourceId,
          outcome: result.outcome,
          details: result.details,
        },
      })
    },
  )

  // POST /v1/dev/whatsapp/scenarios/:scenario/trigger
  app.post<{ Params: { scenario: string } }>(
    '/v1/dev/whatsapp/scenarios/:scenario/trigger',
    { preHandler: SIMULATOR_GUARDS },
    async (req, reply) => {
      assertSimulatorEnabled()
      const { scenario } = scenarioParamsSchema.parse(req.params)
      if (!isSimulatorScenario(scenario)) throw notFound(`Scenario ${scenario} tidak dikenal`)

      const body = triggerBodySchema.parse(req.body ?? {})
      const outcome = await runScenario(scenario, body)

      await tryCreateAuditLog(prisma as any, {
        action: AuditAction.SIMULATOR_TRIGGERED,
        actorUserId: getAuthUser(req).sub,
        actorRole: getAuthUser(req).role,
        resourceType: 'simulator_scenario',
        resourceId: scenario,
        meta: outcome.summary,
      })

      return reply.code(200).send({ data: outcome })
    },
  )

  // POST /v1/dev/whatsapp/scenarios/reset — kembalikan fixture demo ke kondisi awal.
  app.post('/v1/dev/whatsapp/scenarios/reset', { preHandler: SIMULATOR_GUARDS }, async (req, reply) => {
    assertSimulatorEnabled()
    const summary = await resetSimulator()
    const claims = getAuthUser(req)

    await tryCreateAuditLog(prisma as any, {
      action: AuditAction.SIMULATOR_RESET,
      actorUserId: claims.sub,
      actorRole: claims.role,
      resourceType: 'simulator_scenario',
      resourceId: 'reset',
      meta: summary as unknown as Record<string, unknown>,
    })

    return reply.code(200).send({ data: summary })
  })

  // POST /v1/dev/whatsapp/provider-failure — sakelar scenario D.
  app.post('/v1/dev/whatsapp/provider-failure', { preHandler: SIMULATOR_GUARDS }, async (req, reply) => {
    assertSimulatorEnabled()
    const body = z.object({ enabled: z.boolean() }).parse(req.body ?? {})
    const enabled = setProviderFailureSimulation(body.enabled)

    return reply.code(200).send({ data: { enabled } })
  })
}

async function runScenario(
  scenario: SimulatorScenario,
  body: { scheduleId?: string; patientId?: string },
) {
  switch (scenario) {
    case 'REMINDER_CONFIRMED':
      return runReminderConfirmedScenario(body)
    case 'REMINDER_NO_RESPONSE':
      return runReminderNoResponseScenario(body)
    case 'HEART_RATE_ANOMALY':
      return runHeartRateAnomalyScenario(body)
    case 'PROVIDER_FAILURE':
      return runProviderFailureScenario(body)
  }
}

function buttonTitle(message: SandboxMessage, buttonId: string): string {
  return message.buttons.find((b) => b.id === buttonId)?.title ?? buttonId
}