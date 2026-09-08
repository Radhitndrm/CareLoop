// Error pengiriman WhatsApp (CL-101).
// `retryable=true` menyatakan kegagalan sementara (jaringan/5xx) yang layak di-retry;
// `false` untuk kegagalan permanen (validasi, token mati) yang langsung dibuang.
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly options: { provider?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}