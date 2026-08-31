// CL-010: helper audit log. Prisma diganti mock berbentuk sama agar suite tidak
// membutuhkan database.
import { describe, expect, it, vi } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { AuditAction } from '@careloop/shared'
import {
  auditContext,
  createAuditLog,
  sanitizeMeta,
  tryCreateAuditLog,
  type AuditLogClient,
} from './audit'

function clientWith(create = vi.fn().mockResolvedValue({ id: 'a1' })) {
  return {
    client: { auditLog: { create } } as unknown as AuditLogClient,
    create,
  }
}

function dataOf(create: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return create.mock.calls[0][0].data as Record<string, unknown>
}

describe('sanitizeMeta', () => {
  it('menyensor kunci sensitif termasuk variasi penulisannya', () => {
    const clean = sanitizeMeta({
      password: 'rahasia',
      passwordHash: '$2a$12$abc',
      otpCode: '123456',
      accessToken: 'eyJ...',
      Authorization: 'Bearer eyJ...',
      nik: '3404xxxxxxxxxxxx',
      DATA_ENCRYPTION_KEY: 'abcdef',
    })

    expect(Object.values(clean)).toEqual(Array(7).fill('[redacted]'))
  })

  it('membiarkan field non-sensitif apa adanya', () => {
    const meta = { scheduleId: 's1', attempt: 2, late: true, channel: 'WHATSAPP' }
    expect(sanitizeMeta(meta)).toEqual(meta)
  })

  it('menelusuri objek bersarang', () => {
    const clean = sanitizeMeta({
      request: { phone: '081200000001', otp: '123456' },
      result: { status: 'CONFIRMED' },
    })

    expect(clean).toEqual({
      request: { phone: '081200000001', otp: '[redacted]' },
      result: { status: 'CONFIRMED' },
    })
  })

  it('array dan null dibiarkan tanpa penelusuran', () => {
    expect(sanitizeMeta({ tiers: ['FAMILY_TIER_1', 'NAKES'], notes: null })).toEqual({
      tiers: ['FAMILY_TIER_1', 'NAKES'],
      notes: null,
    })
  })
})

describe('createAuditLog', () => {
  it('menulis satu baris dengan seluruh kolom docs/SECURITY.md §8.2', async () => {
    const { client, create } = clientWith()

    const row = await createAuditLog(client, {
      action: AuditAction.COMPLIANCE_CONFIRMED,
      actorUserId: 'u1',
      actorRole: 'PATIENT',
      resourceType: 'compliance_log',
      resourceId: 'c1',
      patientId: 'p1',
      ip: '10.0.0.1',
      userAgent: 'CareLoop/1.0',
      meta: { channel: 'WHATSAPP' },
    })

    expect(row).toEqual({ id: 'a1' })
    expect(dataOf(create)).toEqual({
      action: 'compliance.confirmed',
      actorUserId: 'u1',
      actorRole: 'PATIENT',
      resourceType: 'compliance_log',
      resourceId: 'c1',
      patientId: 'p1',
      ip: '10.0.0.1',
      userAgent: 'CareLoop/1.0',
      meta: { channel: 'WHATSAPP' },
    })
  })

  it('field opsional yang tidak diisi menjadi null, bukan undefined', async () => {
    const { client, create } = clientWith()

    await createAuditLog(client, { action: AuditAction.AUTH_LOGIN })

    expect(dataOf(create)).toMatchObject({
      actorUserId: null,
      actorRole: null,
      resourceType: null,
      resourceId: null,
      patientId: null,
      ip: null,
      userAgent: null,
    })
    // meta dibiarkan undefined agar kolom Json tetap NULL, bukan berisi objek kosong.
    expect(dataOf(create).meta).toBeUndefined()
  })

  it('meta disensor sebelum menyentuh database', async () => {
    const { client, create } = clientWith()

    await createAuditLog(client, {
      action: AuditAction.AUTH_OTP_VERIFY,
      meta: { phone: '081200000001', otp: '123456' },
    })

    expect(dataOf(create).meta).toEqual({ phone: '081200000001', otp: '[redacted]' })
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('123456')
  })

  it('hanya memanggil create — tabel audit bersifat append-only', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' })
    const update = vi.fn()
    const deleteFn = vi.fn()
    const client = {
      auditLog: { create, update, delete: deleteFn },
    } as unknown as AuditLogClient

    await createAuditLog(client, { action: AuditAction.AUTH_LOGIN })

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('kegagalan database diteruskan ke pemanggil', async () => {
    const { client } = clientWith(vi.fn().mockRejectedValue(new Error('koneksi putus')))

    await expect(createAuditLog(client, { action: AuditAction.AUTH_LOGIN })).rejects.toThrow(
      'koneksi putus',
    )
  })
})

describe('tryCreateAuditLog', () => {
  it('mengembalikan true saat penulisan berhasil', async () => {
    const { client } = clientWith()
    await expect(tryCreateAuditLog(client, { action: AuditAction.ESCALATION_STEP })).resolves.toBe(
      true,
    )
  })

  it('kegagalan audit tidak membatalkan aksi utama, hanya dilaporkan ke logger', async () => {
    const { client } = clientWith(vi.fn().mockRejectedValue(new Error('koneksi putus')))
    const logger = { error: vi.fn() }

    const ok = await tryCreateAuditLog(
      client,
      { action: AuditAction.EMERGENCY_TRIGGERED },
      logger,
    )

    expect(ok).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'emergency.triggered' }),
      'gagal menulis audit log',
    )
  })

  it('tanpa logger pun tidak melempar', async () => {
    const { client } = clientWith(vi.fn().mockRejectedValue(new Error('koneksi putus')))
    await expect(
      tryCreateAuditLog(client, { action: AuditAction.EMERGENCY_TRIGGERED }),
    ).resolves.toBe(false)
  })
})

describe('auditContext', () => {
  it('mengambil aktor, ip, dan user agent dari request terautentikasi', () => {
    const req = {
      user: { sub: 'u1', role: 'NAKES' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'CareLoop/1.0' },
    } as unknown as FastifyRequest

    expect(auditContext(req)).toEqual({
      actorUserId: 'u1',
      actorRole: 'NAKES',
      ip: '10.0.0.1',
      userAgent: 'CareLoop/1.0',
    })
  })

  it('request anonim menghasilkan aktor null, bukan gagal', () => {
    const req = { ip: '10.0.0.2', headers: {} } as unknown as FastifyRequest

    expect(auditContext(req)).toEqual({
      actorUserId: null,
      actorRole: null,
      ip: '10.0.0.2',
      userAgent: null,
    })
  })
})
