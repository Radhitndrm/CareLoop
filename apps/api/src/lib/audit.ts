// CL-010: penulisan audit log terpusat (docs/SECURITY.md §8).
// Tabel audit_logs bersifat append-only: helper ini hanya membuat baris, tidak pernah
// memperbarui atau menghapus.
import type { Prisma, PrismaClient } from '@prisma/client'
import type { FastifyRequest } from 'fastify'
import type { AuditAction, AuthUserClaims, UserRole } from '@careloop/shared'

export type AuditLogClient = Pick<PrismaClient, 'auditLog'>

export interface AuditLogInput {
  action: AuditAction | (string & {})
  actorUserId?: string | null
  actorRole?: UserRole | null
  /** Jenis & id objek yang disentuh, misalnya `compliance_log` + uuid-nya. */
  resourceType?: string | null
  resourceId?: string | null
  /** Konteks pasien, diisi walau aktornya nakes/keluarga agar audit bisa difilter per pasien. */
  patientId?: string | null
  ip?: string | null
  userAgent?: string | null
  meta?: Record<string, unknown> | null
}

/**
 * Kunci yang tidak boleh mendarat di kolom `meta` (docs/SECURITY.md §8.2: meta non-sensitif).
 * Pencocokan dilakukan case-insensitive terhadap potongan nama kunci, sehingga
 * `passwordHash`, `otpCode`, dan `authorization` ikut tersaring.
 */
const REDACTED_KEY_PATTERN = /pass|otp|token|secret|authorization|nik|encryption/i
const REDACTED = '[redacted]'

export function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      clean[key] = REDACTED
      continue
    }
    clean[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? sanitizeMeta(value as Record<string, unknown>)
        : value
  }

  return clean
}

/** Ambil aktor, IP, dan user agent dari request yang sudah lolos preHandler authenticate. */
export function auditContext(req: FastifyRequest): Pick<
  AuditLogInput,
  'actorUserId' | 'actorRole' | 'ip' | 'userAgent'
> {
  const claims = req.user as AuthUserClaims | undefined

  return {
    actorUserId: claims?.sub ?? null,
    actorRole: claims?.role ?? null,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  }
}

export async function createAuditLog(
  client: AuditLogClient,
  input: AuditLogInput,
): Promise<{ id: string }> {
  return client.auditLog.create({
    data: {
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      patientId: input.patientId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: input.meta ? (sanitizeMeta(input.meta) as Prisma.InputJsonValue) : undefined,
    },
    select: { id: true },
  })
}

/**
 * Varian untuk jalur kritis (reminder, eskalasi, darurat): kegagalan menulis audit
 * dilaporkan lewat logger dan mengembalikan false, tetapi tidak pernah membatalkan aksi
 * utama. Alert darurat tidak boleh gagal hanya karena baris audit gagal ditulis.
 */
export async function tryCreateAuditLog(
  client: AuditLogClient,
  input: AuditLogInput,
  logger?: { error(obj: unknown, msg: string): void },
): Promise<boolean> {
  try {
    await createAuditLog(client, input)
    return true
  } catch (error) {
    logger?.error({ err: error, action: input.action }, 'gagal menulis audit log')
    return false
  }
}
