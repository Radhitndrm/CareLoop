// CL-008: verifikasi JWT + RBAC sebagai preHandler Fastify.
// Dipakai lintas domain, karena itu di lib/ dan bukan di modules/auth (AGENTS.md §4).
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import type { AuthUserClaims, UserRole } from '@careloop/shared'
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
 * Pasien hanya boleh menyentuh datanya sendiri. Role lain diteruskan — cakupan wilayah
 * nakes (nakes_assignments) dan relasi keluarga ditegakkan di query masing-masing domain.
 */
export function assertOwnPatientData(claims: AuthUserClaims, patientUserId: string): void {
  if (claims.role === 'PATIENT' && claims.sub !== patientUserId) {
    throw forbidden()
  }
}
