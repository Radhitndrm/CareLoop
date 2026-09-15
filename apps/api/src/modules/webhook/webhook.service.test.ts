import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  computeHubSignature,
  verifyHubSignature,
  verifyHubChallenge,
  extractButtonMessage,
  processWebhookMessage,
  intentToNotificationType,
  intentToAuditAction,
  intentToResourceType,
} from './webhook.service'
import { WaButtonIntent } from '../../integrations/whatsapp/parser'
import { AuditAction, NotificationType } from '@careloop/shared'

let runOnceCallCount = 0
vi.mock('../../lib/idempotency', () => ({
  runOnce: vi.fn(async (op: { create: () => Promise<any>; findExisting: () => Promise<any> }) => {
    runOnceCallCount++
    if (runOnceCallCount === 1) {
      return { created: true, value: await op.create() }
    }
    return { created: false, value: await op.findExisting() }
  }),
}))

const TEST_SECRET = 'test-secret-minimal-32-karakter-abcdefg'
const TEST_VERIFY_TOKEN = 'test-verify-token-abc123'
const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const EMERGENCY_ID = '33333333-3333-4333-8333-333333333333'
const ESCALATION_ID = 'run-1'
const MESSAGE_ID = 'wamid.test123'

function buildMetaPayload(buttonReplyId: string, messageId = MESSAGE_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name: 'Bu Siti Test' }, wa_id: '6281234567890' }],
              messages: [
                {
                  from: '6281234567890',
                  id: messageId,
                  timestamp: '1723800000',
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: { id: buttonReplyId, title: 'Sudah Minum' },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function buildRawBody(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8')
}

function createMockPrisma() {
  return {
    notification: {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  }
}

describe('CL-103 — Webhook WhatsApp Hub', () => {
  describe('verifyHubSignature', () => {
    it('mengembalikan true untuk signature yang valid', () => {
      const body = Buffer.from('{"test":"data"}', 'utf8')
      const sig = computeHubSignature(body, TEST_SECRET)
      expect(verifyHubSignature(body, TEST_SECRET, sig)).toBe(true)
    })

    it('mengembalikan false untuk signature yang salah', () => {
      const body = Buffer.from('{"test":"data"}', 'utf8')
      expect(verifyHubSignature(body, TEST_SECRET, 'sha256=abcdef123456')).toBe(false)
    })

    it('mengembalikan false jika header tidak ada', () => {
      const body = Buffer.from('{"test":"data"}', 'utf8')
      expect(verifyHubSignature(body, TEST_SECRET, undefined)).toBe(false)
    })

    it('mengembalikan false untuk header tanpa prefix sha256=', () => {
      const body = Buffer.from('{"test":"data"}', 'utf8')
      expect(verifyHubSignature(body, TEST_SECRET, 'not-a-signature')).toBe(false)
    })
  })

  describe('verifyHubChallenge', () => {
    it('mengembalikan true jika token cocok', () => {
      expect(verifyHubChallenge(TEST_VERIFY_TOKEN, TEST_VERIFY_TOKEN)).toBe(true)
    })

    it('mengembalikan false jika token tidak cocok', () => {
      expect(verifyHubChallenge('wrong-token', TEST_VERIFY_TOKEN)).toBe(false)
    })

    it('mengembalikan false jika salah satu undefined', () => {
      expect(verifyHubChallenge(undefined, TEST_VERIFY_TOKEN)).toBe(false)
      expect(verifyHubChallenge(TEST_VERIFY_TOKEN, undefined)).toBe(false)
    })
  })

  describe('extractButtonMessage', () => {
    it('mengekstrak pesan button_reply dari payload Meta', () => {
      const payload = buildMetaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`)
      const msg = extractButtonMessage(payload)
      expect(msg).toEqual({
        id: MESSAGE_ID,
        from: '6281234567890',
        replyId: `CONFIRM_TAKEN_${SCHEDULE_ID}`,
      })
    })

    it('mengembalikan null untuk payload tanpa button_reply', () => {
      const msg = extractButtonMessage({ entry: [] })
      expect(msg).toBeNull()
    })

    it('mengembalikan null untuk payload kosong', () => {
      expect(extractButtonMessage(null)).toBeNull()
      expect(extractButtonMessage(undefined)).toBeNull()
    })
  })

  describe('intentToNotificationType', () => {
    it('CONFIRM_TAKEN → REMINDER', () => {
      expect(intentToNotificationType(WaButtonIntent.CONFIRM_TAKEN)).toBe(NotificationType.REMINDER)
    })
    it('SAFE → EMERGENCY', () => {
      expect(intentToNotificationType(WaButtonIntent.SAFE)).toBe(NotificationType.EMERGENCY)
    })
    it('HANDLE → ESCALATION', () => {
      expect(intentToNotificationType(WaButtonIntent.HANDLE)).toBe(NotificationType.ESCALATION)
    })
    it('null → OTHER', () => {
      expect(intentToNotificationType(null)).toBe(NotificationType.OTHER)
    })
  })

  describe('intentToAuditAction', () => {
    it('CONFIRM_TAKEN → COMPLIANCE_CONFIRMED', () => {
      expect(intentToAuditAction(WaButtonIntent.CONFIRM_TAKEN)).toBe(AuditAction.COMPLIANCE_CONFIRMED)
    })
    it('DEFER → COMPLIANCE_DEFERRED', () => {
      expect(intentToAuditAction(WaButtonIntent.DEFER)).toBe(AuditAction.COMPLIANCE_DEFERRED)
    })
    it('SAFE → EMERGENCY_RESOLVED', () => {
      expect(intentToAuditAction(WaButtonIntent.SAFE)).toBe(AuditAction.EMERGENCY_RESOLVED)
    })
    it('NEED_HELP → EMERGENCY_TRIGGERED', () => {
      expect(intentToAuditAction(WaButtonIntent.NEED_HELP)).toBe(AuditAction.EMERGENCY_TRIGGERED)
    })
    it('HANDLE → ESCALATION_HANDLED', () => {
      expect(intentToAuditAction(WaButtonIntent.HANDLE)).toBe(AuditAction.ESCALATION_HANDLED)
    })
  })

  describe('intentToResourceType', () => {
    it('CONFIRM_TAKEN → compliance_logs', () => {
      expect(intentToResourceType(WaButtonIntent.CONFIRM_TAKEN)).toBe('compliance_logs')
    })
    it('SAFE → emergency_alert', () => {
      expect(intentToResourceType(WaButtonIntent.SAFE)).toBe('emergency_alert')
    })
    it('HANDLE → escalation_run', () => {
      expect(intentToResourceType(WaButtonIntent.HANDLE)).toBe('escalation_run')
    })
    it('null → null', () => {
      expect(intentToResourceType(null)).toBeNull()
    })
  })

  describe('processWebhookMessage', () => {
    let mockPrisma: ReturnType<typeof createMockPrisma>

    beforeEach(() => {
      mockPrisma = createMockPrisma()
      runOnceCallCount = 0
    })

    it('melempar 401 jika signature tidak valid', async () => {
      const body = buildRawBody(buildMetaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`))
      await expect(
        processWebhookMessage(mockPrisma as any, body, 'sha256=invalid', TEST_SECRET),
      ).rejects.toThrow('Signature webhook WhatsApp tidak valid')
    })

    it('tidak membuat Notification/AuditLog jika signature gagal (tanpa efek samping)', async () => {
      const body = buildRawBody(buildMetaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`))
      try {
        await processWebhookMessage(mockPrisma as any, body, 'sha256=invalid', TEST_SECRET)
      } catch {
        // expected 401
      }
      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled()
    })

    it('memproses CONFIRM_TAKEN dengan benar: notif + audit + intent', async () => {
      const payload = buildMetaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`)
      const body = buildRawBody(payload)
      const sig = computeHubSignature(body, TEST_SECRET)

      const result = await processWebhookMessage(mockPrisma as any, body, sig, TEST_SECRET)

      expect(result.processed).toBe(true)
      expect(result.intent).toBe(WaButtonIntent.CONFIRM_TAKEN)
      expect(result.resourceId).toBe(SCHEDULE_ID)
      expect(mockPrisma.notification.create).toHaveBeenCalledOnce()
      expect(mockPrisma.auditLog.create).toHaveBeenCalledOnce()
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: AuditAction.COMPLIANCE_CONFIRMED,
            resourceType: 'compliance_logs',
          }),
        }),
      )
    })

    it('memproses HANDLE dengan benar: intent HANDLE + audit ESCALATION_HANDLED', async () => {
      const payload = buildMetaPayload(`HANDLE_${ESCALATION_ID}`)
      const body = buildRawBody(payload)
      const sig = computeHubSignature(body, TEST_SECRET)

      const result = await processWebhookMessage(mockPrisma as any, body, sig, TEST_SECRET)

      expect(result.processed).toBe(true)
      expect(result.intent).toBe(WaButtonIntent.HANDLE)
      expect(result.resourceId).toBe(ESCALATION_ID)
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: AuditAction.ESCALATION_HANDLED,
          }),
        }),
      )
    })

    it('kirim ganda message.id → hanya 1 proses, 200 ignore', async () => {
      const payload = buildMetaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`)
      const body = buildRawBody(payload)
      const sig = computeHubSignature(body, TEST_SECRET)

      const result1 = await processWebhookMessage(mockPrisma as any, body, sig, TEST_SECRET)
      expect(result1.processed).toBe(true)

      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'notif-1',
        providerMessageId: MESSAGE_ID,
      })

      const result2 = await processWebhookMessage(mockPrisma as any, body, sig, TEST_SECRET)
      expect(result2.processed).toBe(false)
      expect(result2.intent).toBe(WaButtonIntent.CONFIRM_TAKEN)

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1)
      expect(mockPrisma.auditLog.create).toHaveBeenCalledOnce()
    })

    it('mengembalikan processed:true untuk pesan tanpa button_reply', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: { messages: [{ id: 'msg-1', from: '6281234567890', type: 'text' }] } }] }],
      }
      const body = buildRawBody(payload)
      const sig = computeHubSignature(body, TEST_SECRET)

      const result = await processWebhookMessage(mockPrisma as any, body, sig, TEST_SECRET)
      expect(result.processed).toBe(true)
      expect(result.intent).toBeNull()
    })
  })
})
