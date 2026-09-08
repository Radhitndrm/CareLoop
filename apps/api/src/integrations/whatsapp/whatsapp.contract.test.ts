// Contract test CL-101: payload yang direkam mock provider memenuhi shape stabil
// (golden fixture). Ini yang dipetakan ke body provider riil (Meta) di CL-102+.
// Ref: docs/TESTING.md §10 — "Contract test: objek kirim sesuai shape provider (golden fixture)".
import { describe, expect, it } from 'vitest'
import golden from './fixtures/outbound-message.golden.json'
import { createWhatsAppService } from './whatsapp.service'
import { MockWhatsAppProvider } from './providers/mock.provider'
import type { OutboundWhatsAppMessage, WaRecipient } from './types'

interface GoldenRecorded {
  id: string
  to: WaRecipient
  payload: OutboundWhatsAppMessage
}

interface GoldenContractFixture {
  description: string
  request: OutboundWhatsAppMessage
  expectedRecorded: GoldenRecorded
}

const fixture = golden as unknown as GoldenContractFixture

describe('contract WhatsAppService — golden fixture', () => {
  it('merekam pesan interaktif dengan shape stabil (id, to E.164, payload)', async () => {
    const provider = new MockWhatsAppProvider()
    const service = createWhatsAppService({ provider })

    const result = await service.send(fixture.request)

    expect(provider.sent).toHaveLength(1)
    const record = provider.sent[0]
    expect({ id: record.id, to: record.to, payload: record.payload }).toEqual(
      fixture.expectedRecorded,
    )
    expect(record.sentAt).toBeInstanceOf(Date)
    expect(result).toEqual({ providerMessageId: fixture.expectedRecorded.id, sentAt: record.sentAt })
  })
})