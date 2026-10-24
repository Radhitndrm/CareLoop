// Idempotensi webhook WhatsApp terhadap database sungguhan.
//
// Suite `webhook.service.test.ts` memock `runOnce`, sehingga jalur yang paling rawan —
// Prisma melempar P2002 saat `providerMessageId` sudah dipakai — tidak pernah diuji di sana.
// Test ini sengaja memakai `runOnce` asli dan DB test: bug nama constraint hanya muncul
// ketika Prisma benar-benar menolak create.
//
// Gejala kalau rusak: Meta mengirim ulang payload, backend membalas 500, lalu Meta
// mengulang terus-menerus ke payload yang memang tidak akan pernah bisa diproses.
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { DEMO_IDS, DEMO_PHONES, seedDemoPersonas } from '../prisma/personas'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const SECRET = 'test-secret-rahasia-webhook'
const MESSAGE_ID = 'wamid.IDEMPOTENCY-TEST'
const PAK_HAJI_WA = `62${DEMO_PHONES.pakHaji.slice(1)}`

// `processWebhookMessage` butuh signature HMAC yang valid; dihitung persis seperti
// `computeHubSignature` di service.

function buildRaw(buttonId: string, messageId = MESSAGE_ID) {
  return Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WAID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    from: PAK_HAJI_WA,
                    id: messageId,
                    timestamp: '1723800000',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: buttonId, title: 'Sudah Minum' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
    'utf8',
  )
}

function signatureFor(raw: Buffer): string {
  return `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`
}

describe.skipIf(!isTestDbConfigured())('Idempotensi webhook WhatsApp (P2002)', () => {
  let prisma: PrismaClient
  let processWebhookMessage: typeof import('../src/modules/webhook/webhook.service')['processWebhookMessage']

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
    ;({ processWebhookMessage } = await import('../src/modules/webhook/webhook.service'))
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  beforeEach(async () => {
    await resetTestDb(prisma)
    await seedDemoPersonas(prisma)
  })

  it('P2002 Prisma melaporkan target sebagai KOLOM, bukan nama index', async () => {
    await prisma.notification.create({
      data: { providerMessageId: MESSAGE_ID, channel: 'WHATSAPP', type: 'OTHER', title: 'a', body: 'a' },
    })

    let target: unknown
    try {
      await prisma.notification.create({
        data: { providerMessageId: MESSAGE_ID, channel: 'WHATSAPP', type: 'OTHER', title: 'b', body: 'b' },
      })
    } catch (err) {
      target = (err as Prisma.PrismaClientKnownRequestError).meta?.target
    }

    // Guard regresi: kalau Prisma suatu saat melaporkan nama index, nilai di bawah ikut
    // berubah dan test ini harus diperbarui — bukan diam-diam lolos.
    expect(target).toEqual(['providerMessageId'])
  })

  it('kiriman Meta kedua dengan message.id sama dibalas 200, bukan 500', async () => {
    const raw = buildRaw(`CONFIRM_TAKEN_${DEMO_IDS.scheduleAmlodipinePagi}`)
    const sig = signatureFor(raw)

    const first = await processWebhookMessage(prisma as any, raw, sig, SECRET)
    expect(first.processed).toBe(true)

    // Meta mengulang payload yang sama — harus dianggap "sudah diproses", bukan error.
    const second = await processWebhookMessage(prisma as any, raw, sig, SECRET)
    expect(second.processed).toBe(false)
    expect(second.intent).toBe('CONFIRM_TAKEN')
    expect(second.dispatch).toBeNull()

    expect(await prisma.notification.count({ where: { providerMessageId: MESSAGE_ID } })).toBe(1)
  })

  it('kiriman pertama tetap diproses penuh setelah ada kiriman lain yang lewat', async () => {
    const rawA = buildRaw(`CONFIRM_TAKEN_${DEMO_IDS.scheduleAmlodipinePagi}`, 'wamid.A')
    const rawB = buildRaw(`DEFER_${DEMO_IDS.scheduleAmlodipinePagi}`, 'wamid.B')

    const a = await processWebhookMessage(prisma as any, rawA, signatureFor(rawA), SECRET)
    const b = await processWebhookMessage(prisma as any, rawB, signatureFor(rawB), SECRET)

    expect(a.processed).toBe(true)
    expect(b.processed).toBe(true)
    expect(await prisma.notification.count()).toBe(2)
  })
})