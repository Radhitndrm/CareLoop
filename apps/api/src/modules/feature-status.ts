// Kontrak kejujuran endpoint yang belum selesai (Fase G plan operasional).
//
// Plan menyatakan: "Fitur yang belum selesai tidak boleh terlihat seperti berhasil."
// Awalnya beberapa endpoint mengembalikan `data: []` atau angka nol, sehingga klien
// tidak bisa membedakan "tidak ada data" dari "belum diimplementasikan". Itu berbahaya
// di konteks kesehatan: risk score `0 / LOW` terlihat seperti "//patient aman", padahal
// tidak ada perhitungan sama sekali.
//
// Solusinya bukan menyembunyikan endpoint, melainkan status yang eksplisit: endpoint
// tetap menjawab, tetapi dengan label yang jelas sehingga UI maupun integrator tahu
// persis apa yang sudah jadi dan apa yang belum.
//
// Label yang dipakai (docs/API.md §1.6):
//
//   AVAILABLE — fitur selesai dan berjalan
//   MOCK      — sengaja memakai data contoh/provider dummy
//   PENDING   — sudah ditulis kontraknya, belum diimplementasikan
//   FORBIDDEN — sengaja ditutup untuk peran ini
export const FEATURE_STATUS = {
  AVAILABLE: 'AVAILABLE',
  MOCK: 'MOCK',
  PENDING: 'PENDING',
  FORBIDDEN: 'FORBIDDEN',
} as const
export type FeatureStatus = (typeof FEATURE_STATUS)[keyof typeof FEATURE_STATUS]

/** Badge yang boleh dipakai UI tanpa menerjemahkan ulang. */
export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  AVAILABLE: 'Tersedia',
  MOCK: 'Demo/mock',
  PENDING: 'Segera hadir',
  FORBIDDEN: 'Tidak tersedia untuk role ini',
}

/** Pesan yang menjelaskan kenapa fitur belum tersedia — untuk ditampilkan apa adanya. */
export const FEATURE_STATUS_DETAIL: Record<FeatureStatus, string> = {
  AVAILABLE: '',
  MOCK: 'Data contoh, bukan data pasien sebenarnya.',
  PENDING: 'Belum diimplementasikan. Jangan dipakai untuk keputusan klinis.',
  FORBIDDEN: 'Endpoint ini sengaja tidak dibuka untuk peran Anda.',
}

export interface FeatureEnvelope<T> {
  status: FeatureStatus
  statusLabel: string
  statusDetail: string
  data: T
}

/**
 * Bungkus hasil endpoint yang belum selesai dengan label statusnya.
 *
 * `data` tetap ada supaya kontrak respons tidak berubah dan UI bisa menampilkan
 * "belum ada data" dengan jujur alih-alih crash.
 */
export function featureEnvelope<T>(
  status: Exclude<FeatureStatus, 'AVAILABLE'>,
  data: T,
): FeatureEnvelope<T> {
  return {
    status,
    statusLabel: FEATURE_STATUS_LABEL[status],
    statusDetail: FEATURE_STATUS_DETAIL[status],
    data,
  }
}
