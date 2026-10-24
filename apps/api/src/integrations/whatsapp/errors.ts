// Error pengiriman WhatsApp (CL-101).
// `retryable=true` menyatakan kegagalan sementara (jaringan/5xx) yang layak di-retry;
// `false` untuk kegagalan permanen (validasi, token mati) yang langsung dibuang.
//
// `providerCode` membawa kode error asli dari Meta (mis. 131047 = di luar jendela 24 jam)
// supaya pemanggil bisa bereaksi spesifik — bukan sekadar melihat pesan teks. Tanpa itu,
// "ganti ke template" hanya bisa ditebak dari string pesan yang bisa berubah kapan saja.
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly options: {
      provider?: string
      retryable?: boolean
      /** Kode error provider (Graph API `error.code`), bila ada. */
      providerCode?: number
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}

/**
 * Meta menolak pesan di luar jendela layanan 24 jam. Ini kondisi yang **normal**, bukan
 * kegagalan: artinya pengingat proaktif hanya boleh dikirim lewat template yang sudah
 * disetujui Meta.
 */
export const WA_ERROR_WINDOW_CLOSED = 131047

/** True bila error berasal dari Meta karena jendela 24 jam tertutup. */
export function isWindowClosedError(error: unknown): boolean {
  return (
    error instanceof WhatsAppSendError && error.options.providerCode === WA_ERROR_WINDOW_CLOSED
  )
}