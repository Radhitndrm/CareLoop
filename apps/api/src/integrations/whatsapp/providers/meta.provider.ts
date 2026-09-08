// Meta WhatsApp Cloud API — STUB untuk CL-101.
// Integrasi riil sengaja ditunda (out of scope CL-101; lihat ADR-002 / docs/TESTING.md §10).
// Kelas ini ada supaya sisi pemanggil & DI sudah jelas saat provider di-swap dari mock.
import { WhatsAppSendError } from '../errors'
import type {
  OutboundWhatsAppMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../types'

export interface MetaCloudApiOptions {
  token: string
  phoneId: string
}

export class MetaCloudApiProvider implements WhatsAppProvider {
  readonly name = 'meta-cloud-api'

  constructor(private readonly options: MetaCloudApiOptions) {}

  async send(_message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    throw new WhatsAppSendError(
      'Provider Meta Cloud API belum terintegrasi — diselesaikan setelah CL-101 (CL-106/107/110 memakainya)',
      { provider: this.name, retryable: false },
    )
  }
}