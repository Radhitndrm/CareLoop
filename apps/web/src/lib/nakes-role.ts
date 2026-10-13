import type { ApiUser } from '@/lib/api'

export const NAKES_ROLE_LABEL: Record<string, string> = {
  DOKTER: 'Dokter',
  PERAWAT: 'Perawat',
  BIDAN: 'Bidan',
  KADER: 'Kader',
  FARMASI: 'Farmasi',
  LAINNYA: 'Nakes',
}

export const ACCOUNT_ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator Dinkes',
  NAKES: 'Nakes',
  PATIENT: 'Pasien',
  FAMILY: 'Keluarga',
}

/** Label peran yang tampil di antarmuka — bukan enum mentah. */
export function accountRoleLabel(user: ApiUser): string {
  if (user.role === 'ADMIN') return ACCOUNT_ROLE_LABEL.ADMIN
  if (user.role === 'PATIENT') return ACCOUNT_ROLE_LABEL.PATIENT
  if (user.role === 'FAMILY') return ACCOUNT_ROLE_LABEL.FAMILY
  return NAKES_ROLE_LABEL[user.nakesRole ?? ''] ?? 'Nakes'
}

/** Peran berwenang mengambil keputusan klinis. */
export function hasClinicalAuthority(user: ApiUser | null): boolean {
  if (!user) return false
  return user.role === 'ADMIN' || user.nakesRole === 'DOKTER' || user.nakesRole === 'BIDAN'
}