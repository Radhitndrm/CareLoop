// CL-008: verifikasi JWT + RBAC sebagai preHandler Fastify.
// Dipakai lintas domain, karena itu di lib/ dan bukan di modules/auth (AGENTS.md §4).
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { NakesRole, UserRole, type AuthUserClaims } from '@careloop/shared'
import { forbidden, unauthorized } from './errors'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUserClaims
    user: AuthUserClaims
  }
}

/**
 * Verifikasi `Authorization: Bearer <token>` dan isi `req.user` dengan claim.
 * Semua kegagalan (header hilang, format salah, tanda tangan tidak cocok, kedaluwarsa)
 * menjadi 401 dengan pesan seragam — detail penyebabnya tidak dibocorkan ke klien.
 */
export const authenticate: preHandlerAsyncHookHandler = async (req: FastifyRequest) => {
  try {
    await req.jwtVerify()
  } catch {
    throw unauthorized()
  }
}

export function getAuthUser(req: FastifyRequest): AuthUserClaims {
  const claims = req.user as AuthUserClaims | undefined
  if (!claims?.sub) throw unauthorized()
  return claims
}

/**
 * Batasi route ke role tertentu. Verifikasi token ikut dijalankan bila `authenticate`
 * belum sempat mengisi `req.user`, sehingga route cukup memasang satu preHandler.
 */
export function requireRole(...allowedRoles: UserRole[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await authenticate.call(req.server, req, reply)

    const claims = getAuthUser(req)
    if (!allowedRoles.includes(claims.role)) {
      throw forbidden()
    }
  }
}

/**
 * Gerbang kewenangan klinis (docs/API.md §3.2): selain role aplikasi, nakes
 * harus punya NakesRole yang berwenang — DOKTER atau BIDAN.
 *
 * Perawat/bidan tetap boleh membuat draft resep, tetapi tidak boleh menyetakannya
 * menjadi aktif, karena keputusan itu berisiko false alarm atau gagal mendeteksi
 * bahaya. ADMIN tetap lolos: admin sudah melewati gate peran di route.
 */
export function requireClinicalRole(...allowed: NakesRole[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await authenticate.call(req.server, req, reply)

    const claims = getAuthUser(req)
    if (claims.role === UserRole.ADMIN) return

    if (claims.role !== UserRole.NAKES || !claims.nakesRole || !allowed.includes(claims.nakesRole)) {
      throw forbidden('Tindakan ini hanya dapat dilakukan oleh dokter atau bidan')
    }
  }
}

/**
 * Gerbang kewenangan farmasi (docs/API.md §3.6): hanya NakesRole.FARMASI yang boleh
 * mengubah status penyiapan dan menyerahkan obat.
 *
 * Sengaja TIDAK memakai requireClinicalRole: apotek bukan pengambil keputusan
 * klinis. Menyetujui permintaan obat & mengubah resep tetap milik DOKTER/BIDAN —
 * jadi satu peran tidak bisa melakukan dua hal yang bertentangan.
 */
export function requirePharmacyRole(...allowed: NakesRole[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await authenticate.call(req.server, req, reply)

    const claims = getAuthUser(req)
    if (claims.role === UserRole.ADMIN) return

    if (claims.role !== UserRole.NAKES || !claims.nakesRole || !allowed.includes(claims.nakesRole)) {
      throw forbidden('Tindakan ini hanya dapat dilakukan oleh petugas farmasi')
    }
  }
}

/**
 * Gerbang akses klinik (dashboard, daftar pasien, data pasien, vital, darurat,
 * eskalasi): seluruh NakesRole KECUALI FARMASI.
 *
 * Dipisah dari `requireRole(UserRole.NAKES)` karena itu terlalu longgar —
 * apoteker punya `role=NAKES` sehingga akan ikut mendapat akses ke data pasien
 * lengkap (NIK, alamat, riwayat penyakit, skor risiko, ambang HR) yang tidak
 * diperlukan untuk menyiapkan dan menyerahkan obat (docs/API.md §3.6).
 *
 * ADMIN tetap lolos — admin sudah melewati gate peran di route dan aksesnya
 * memang lintas wilayah.
 */
export function requireCareTeamRole(): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await authenticate.call(req.server, req, reply)

    const claims = getAuthUser(req)
    if (claims.role === UserRole.ADMIN) return

    if (claims.role !== UserRole.NAKES || claims.nakesRole === NakesRole.FARMASI) {
      throw forbidden('Halaman ini khusus tenaga kesehatan')
    }
  }
}

/**
 * Pasien hanya boleh menyentuh datanya sendiri. Role lain diteruskan — cakupan wilayah
 * nakes (nakes_assignments) dan relasi keluarga ditegakkan di query masing-masing domain.
 */
export function assertOwnPatientData(claims: AuthUserClaims, patientUserId: string): void {
  if (claims.role === 'PATIENT' && claims.sub !== patientUserId) {
    throw forbidden()
  }
}
