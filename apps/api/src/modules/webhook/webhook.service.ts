import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import {
  Channel,
  NotificationType,
  NotificationStatus,
  AuditAction,
} from '@careloop/shared'
import { runOnce } from '../../lib/idempotency'
import { createAuditLog, type AuditLogClient } from '../../lib/audit'
import { getReminderJobQueue } from '../reminders/reminder.queue'
import { dispatchWaIntent, type WaIntentPrismaClient } from '../wa-intents'
import {
  parseButtonReply,
  TemplateConfirmButtonId,
  WaButtonIntent,
  type ParsedButtonReply,
} from '../../integrations/whatsapp/parser'
import { sendReminderConfirmButtons } from '../reminders/reminder.buttons'
import { getWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'

/**
 * Webhook butuh tiga hal sekaligus: dedup+catatan notifikasi (`notification`),
 * audit (`auditLog`), dan tabel domain yang disentuh dispatcher intent (CL-112).
 */
export type WebhookPrismaClient = Pick<PrismaClient, 'notification' | 'auditLog'> &
  AuditLogClient &
  WaIntentPrismaClient

export interface WebhookProcessResult {
  processed: boolean
  intent: string | null
  resourceId: string | null
  /** Hasil domain dari dispatcher; null bila tidak ada intent/resource untuk diproses. */
  dispatch: {
    outcome: string
    resourceType: string
    resourceId: string
    details: Record<string, unknown>
  } | null
  /**
   * Error domain (409/403/422) yang sengaja tidak dilempar keluar.
   *
   * Balasan yang sudah diproses atau datang dari nomor yang salah akan selalu ditolak
   * dengan cara yang sama, jadi mengembalikan 500 hanya membuat Meta mengirim ulang
   * payload yang memang tidak akan pernah berhasil.
   */
  dispatchError: { code: string; message: string } | null
}

export function computeHubSignature(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
}

export function verifyHubSignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false
  const expected = computeHubSignature(rawBody, secret)
  const received = signatureHeader.trim()
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

export function verifyHubChallenge(
  verifyToken: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!verifyToken || !expectedToken) return false
  if (verifyToken.length !== expectedToken.length) return false
  return timingSafeEqual(Buffer.from(verifyToken), Buffer.from(expectedToken))
}

export interface ExtractedMessage {
  id: string
  from: string
  replyId: string | undefined
  /**
   * Id pesan yang dijawab (`interactive.context.id`).
   *
   * Ini satu-satunya cara memetakan balasan tombol di dalam message template kembali
   * ke jadwal tertentu: payload quick-reply bersifat tetap di Meta, jadi tidak bisa
   * membawa `scheduleId`. `context.id` menunjuk ke `reminder_logs.providerMessageId`.
   */
  contextMessageId: string | null
}

export function extractButtonMessage(payload: unknown): ExtractedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const entry = (payload as Record<string, unknown>).entry
  if (!Array.isArray(entry) || entry.length === 0) return null
  const changes = (entry[0] as Record<string, unknown>)?.changes
  if (!Array.isArray(changes) || changes.length === 0) return null
  const messages = (changes[0] as Record<string, unknown>)?.value
  if (!messages || typeof messages !== 'object') return null
  const msgs = (messages as Record<string, unknown>).messages
  if (!Array.isArray(msgs) || msgs.length === 0) return null

  const m = msgs[0] as Record<string, unknown>
  if (!m?.id || !m?.from) return null
  const interactive = m.interactive as Record<string, unknown> | undefined
  if (interactive?.type !== 'button_reply') return null
  const buttonReply = interactive.button_reply as Record<string, unknown> | undefined

  const context = interactive.context as Record<string, unknown> | undefined

  return {
    id: String(m.id),
    from: String(m.from),
    replyId: buttonReply?.id ? String(buttonReply.id) : undefined,
    contextMessageId: context?.id ? String(context.id) : null,
  }
}

export function intentToNotificationType(intent: string | null): NotificationType {
  switch (intent) {
    case WaButtonIntent.CONFIRM_TAKEN:
    case WaButtonIntent.DEFER:
      return NotificationType.REMINDER
    case WaButtonIntent.SAFE:
    case WaButtonIntent.NEED_HELP:
      return NotificationType.EMERGENCY
    case WaButtonIntent.HANDLE:
      return NotificationType.ESCALATION
    default:
      return NotificationType.OTHER
  }
}

export function intentToAuditAction(intent: string): AuditAction {
  switch (intent) {
    case WaButtonIntent.CONFIRM_TAKEN:
      return AuditAction.COMPLIANCE_CONFIRMED
    case WaButtonIntent.DEFER:
      return AuditAction.COMPLIANCE_DEFERRED
    case WaButtonIntent.SAFE:
      return AuditAction.EMERGENCY_RESOLVED
    case WaButtonIntent.NEED_HELP:
      return AuditAction.EMERGENCY_TRIGGERED
    case WaButtonIntent.HANDLE:
      return AuditAction.ESCALATION_HANDLED
    default:
      return AuditAction.COMPLIANCE_CONFIRMED
  }
}

export function intentToResourceType(intent: string | null): string | null {
  switch (intent) {
    case WaButtonIntent.CONFIRM_TAKEN:
    case WaButtonIntent.DEFER:
      return 'compliance_logs'
    case WaButtonIntent.HANDLE:
      return 'escalation_run'
    case WaButtonIntent.SAFE:
    case WaButtonIntent.NEED_HELP:
      return 'emergency_alert'
    default:
      return null
  }
}

export async function processWebhookMessage(
  prisma: WebhookPrismaClient,
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): Promise<WebhookProcessResult> {
  if (!verifyHubSignature(rawBody, appSecret, signatureHeader)) {
    throw Object.assign(new Error('Signature webhook WhatsApp tidak valid'), {
      statusCode: 401,
      code: 'WEBHOOK_SIGNATURE_INVALID',
    })
  }

  const payload = JSON.parse(rawBody.toString('utf8')) as unknown
  const message = extractButtonMessage(payload)
  if (!message || !message.replyId) {
    return { processed: true, intent: null, resourceId: null, dispatch: null, dispatchError: null }
  }

  const parsed: ParsedButtonReply | null = parseButtonReply(message.replyId)
  const intent = parsed?.intent ?? null
  const resourceId = parsed?.resourceId ?? null

  const dedup = await runOnce({
    // Nama KOLOM, bukan nama index. Prisma melaporkan `meta.target` sebagai kolom yang
    // melanggar (diverifikasi terhadap P2002), sedangkan nama index
    // `Notification_providerMessageId_key` tidak pernah muncul di sana — kalau dipakai,
    // setiap kiriman ganda akan dilempar sebagai error dan Meta mengulang tanpa henti.
    constraint: 'providerMessageId',
    create: () =>
      prisma.notification.create({
        data: {
          providerMessageId: message.id,
          channel: Channel.WHATSAPP,
          type: intentToNotificationType(intent),
          title: intent ? `Webhook ${intent} diterima` : 'Webhook WhatsApp diterima',
          body: message.replyId ?? message.id,
          status: NotificationStatus.PENDING,
        },
      }),
    findExisting: () =>
      prisma.notification.findFirst({
        where: { providerMessageId: message.id },
      }),
  })

  if (!dedup.created) {
    return { processed: false, intent, resourceId, dispatch: null, dispatchError: null }
  }

  if (intent) {
    await createAuditLog(prisma, {
      action: intentToAuditAction(intent),
      resourceType: intentToResourceType(intent),
      resourceId,
      meta: { messageId: message.id, from: message.from },
    })
  }

  // Balasan quick-reply pada message template (`KONFIRMS`): bukan intent bisnis, tapi
  // sinyal bahwa jendela 24 jam sudah terbuka dan CareLoop boleh mengirim tombol
  // konfirmasi yang sesungguhnya. Ditangani sebelum cabang intent biasa.
  if (message.replyId === TemplateConfirmButtonId) {
    const buttons = await sendReminderConfirmButtons(
      prisma as any,
      getWhatsAppService(),
      { contextMessageId: message.contextMessageId, from: message.from },
    )

    await createAuditLog(prisma, {
      action: AuditAction.REMINDER_SENT,
      resourceType: 'schedule',
      resourceId: buttons.scheduleId,
      meta: {
        messageId: message.id,
        from: message.from,
        contextMessageId: message.contextMessageId,
        sent: buttons.sent,
        reason: buttons.reason,
      },
    })

    return {
      processed: true,
      intent: null,
      resourceId: buttons.scheduleId,
      dispatch: buttons.sent
        ? {
            outcome: 'CONFIRM_BUTTONS_SENT',
            resourceType: 'schedule',
            resourceId: buttons.scheduleId as string,
            details: { alreadySent: buttons.alreadySent },
          }
        : null,
      dispatchError: buttons.sent
        ? null
        : {
            code: 'CONFIRM_BUTTONS_NOT_SENT',
            message: buttons.reason ?? 'Tombol konfirmasi tidak terkirim',
          },
    }
  }

  // CL-112: tombol yang ditekan baru benar-benar mengubah state di sini.
  if (!intent || !resourceId) {
    return { processed: true, intent, resourceId, dispatch: null, dispatchError: null }
  }

  try {
    const result = await dispatchWaIntent(
      { prisma, reminderQueue: getReminderJobQueue() },
      {
        intent,
        resourceId,
        actorPhone: message.from,
        sourceMessageId: message.id,
      },
    )

    return {
      processed: true,
      intent,
      resourceId,
      dispatch: {
        outcome: result.outcome,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        details: result.details,
      },
      dispatchError: null,
    }
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string; statusCode?: number }
    return {
      processed: true,
      intent,
      resourceId,
      dispatch: null,
      dispatchError: {
        code: error.code ?? 'WA_INTENT_REJECTED',
        message: error.message ?? 'Intent tidak dapat diproses',
      },
    }
  }
}
