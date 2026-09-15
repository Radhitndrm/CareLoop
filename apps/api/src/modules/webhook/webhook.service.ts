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
import {
  parseButtonReply,
  WaButtonIntent,
  type ParsedButtonReply,
} from '../../integrations/whatsapp/parser'

export type WebhookPrismaClient = Pick<PrismaClient, 'notification' | 'auditLog'> & AuditLogClient

export interface WebhookProcessResult {
  processed: boolean
  intent: string | null
  resourceId: string | null
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

  return {
    id: String(m.id),
    from: String(m.from),
    replyId: buttonReply?.id ? String(buttonReply.id) : undefined,
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
    return { processed: true, intent: null, resourceId: null }
  }

  const parsed: ParsedButtonReply | null = parseButtonReply(message.replyId)
  const intent = parsed?.intent ?? null
  const resourceId = parsed?.resourceId ?? null

  const dedup = await runOnce({
    constraint: 'Notification_providerMessageId_key',
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
    return { processed: false, intent, resourceId }
  }

  if (intent) {
    await createAuditLog(prisma, {
      action: intentToAuditAction(intent),
      resourceType: intentToResourceType(intent),
      resourceId,
      meta: { messageId: message.id, from: message.from },
    })
  }

  return { processed: true, intent, resourceId }
}
