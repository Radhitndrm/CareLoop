// CL-103 — integrasi HTTP untuk POST/GET /webhooks/whatsapp.
//
// Suite ini sengaja menembak route lewat app.inject (bukan memanggil service langsung)
// karena verifikasi signature HMAC hanya bisa dibuktikan benar jika digest dihitung atas
// byte persis seperti yang diterima server. Unit test di webhook.service.test.ts tidak
// bisa menangkap bug rawBody yang membuat endpoint selalu membalas 401.
//
// Yang di-mock hanya lapisan database; runOnce (CL-009) dijalankan sungguhan agar
// jalur dedup ikut teruji.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { AuditAction, NotificationType } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { computeHubSignature } from './webhook.service'

const APP_SECRET = 'test-app-secret-minimal-32-karakter-abcdefg'
const VERIFY_TOKEN = 'test-verify-token-abc123'
const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const NOTIF_CONSTRAINT = 'Notification_providerMessageId_key'

function metaPayload(buttonReplyId: string, messageId: string): unknown {
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

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [NOTIF_CONSTRAINT] },
  })
}

function stubPrisma() {
  return {
    notificationCreate: vi
      .spyOn(prisma.notification, 'create')
      .mockResolvedValue({ id: 'notif-1' } as never),
    notificationFindFirst: vi
      .spyOn(prisma.notification, 'findFirst')
      .mockResolvedValue(null as never),
    auditCreate: vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'audit-1' } as never),
  }
}

/** Ambil argumen pertama yang diterima spy Prisma tanpa tersedak generic-nya. */
function firstCallData(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return (spy.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data
}

describe('Webhook Routes (CL-103)', () => {
  let app: FastifyInstance
  let stubs: ReturnType<typeof stubPrisma>

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'
    process.env.WA_APP_SECRET = APP_SECRET
    process.env.WA_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })
    await app.ready()
  })

  beforeEach(() => {
    stubs = stubPrisma()
  })

  /**
   * Kirim raw string (bukan objek) supaya byte yang ditandatangani identik dengan byte
   * yang diterima Fastify — JSON.stringify ulang bisa mengubah urutan key.
   */
  function signedPost(payload: unknown, opts: { secret?: string; messageId?: string } = {}) {
    const raw = JSON.stringify(payload)
    const secret = opts.secret ?? APP_SECRET
    return app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': computeHubSignature(Buffer.from(raw, 'utf8'), secret),
      },
      payload: raw,
    })
  }

  describe('POST /webhooks/whatsapp', () => {
    it('menerima payload bertanda tangan valid dan mencatat Notification + AuditLog', async () => {
      const res = await signedPost(metaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`, 'wamid.valid.1'))

      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({
        processed: true,
        intent: 'CONFIRM_TAKEN',
        resourceId: SCHEDULE_ID,
      })
      expect(stubs.notificationCreate).toHaveBeenCalledTimes(1)
      expect(firstCallData(stubs.notificationCreate)).toMatchObject({
        providerMessageId: 'wamid.valid.1',
        type: NotificationType.REMINDER,
      })
      expect(stubs.auditCreate).toHaveBeenCalledTimes(1)
      expect(firstCallData(stubs.auditCreate)).toMatchObject({
        action: AuditAction.COMPLIANCE_CONFIRMED,
        resourceType: 'compliance_logs',
        resourceId: SCHEDULE_ID,
      })
    })

    it('menolak request tanpa header signature dengan 401 dan tanpa efek samping', async () => {
      const raw = JSON.stringify(metaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`, 'wamid.nosig.1'))
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { 'content-type': 'application/json' },
        payload: raw,
      })

      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('WEBHOOK_SIGNATURE_INVALID')
      expect(stubs.notificationCreate).not.toHaveBeenCalled()
      expect(stubs.auditCreate).not.toHaveBeenCalled()
    })

    it('menolak signature yang dihitung dengan secret lain dengan 401', async () => {
      const res = await signedPost(
        metaPayload(`CONFIRM_TAKEN_${SCHEDULE_ID}`, 'wamid.wrongsig.1'),
        {
          secret: 'secret-yang-salah',
        },
      )

      expect(res.statusCode).toBe(401)
      expect(stubs.notificationCreate).not.toHaveBeenCalled()
    })

    it('mengabaikan payload valid yang tidak berisi button_reply', async () => {
      const res = await signedPost({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      from: '6281234567890',
                      id: 'wamid.text.1',
                      type: 'text',
                      text: { body: 'halo' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({ processed: true, intent: null })
      expect(stubs.auditCreate).not.toHaveBeenCalled()
    })

    it('kirim ganda message.id sama → hanya diproses sekali, request kedua di-ignore 200', async () => {
      const payload = metaPayload(`HANDLE_run-1`, 'wamid.dupe.1')

      const first = await signedPost(payload)
      expect(first.statusCode).toBe(200)
      expect(first.json().data.processed).toBe(true)
      expect(stubs.notificationCreate).toHaveBeenCalledTimes(1)

      // Pemiriman ulang: unique index providerMessageId dilanggar, runOnce harus
      // menangkapnya dan mengembalikan record lama tanpa membuat Notification baru.
      stubs.notificationCreate.mockRejectedValueOnce(uniqueViolation())
      stubs.notificationFindFirst.mockResolvedValueOnce({ id: 'notif-1' } as never)

      const second = await signedPost(payload)
      expect(second.statusCode).toBe(200)
      expect(second.json().data).toMatchObject({ processed: false, intent: 'HANDLE' })
      expect(stubs.notificationCreate).toHaveBeenCalledTimes(2)
      expect(stubs.auditCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('GET /webhooks/whatsapp', () => {
    it('mengembalikan challenge saat mode subscribe dan verify token cocok', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123456`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('123456')
    })

    it('menolak verify token yang salah dengan 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-salah&hub.challenge=123456',
      })

      expect(res.statusCode).toBe(403)
    })

    it('menolak mode selain subscribe dengan 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=123456`,
      })

      expect(res.statusCode).toBe(403)
    })
  })
})
