import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PATIENT_ID = '22222222-2222-4222-8222-222222222222'
const NAKES_ID = '33333333-3333-4333-8333-333333333333'
const SCHEDULE_ID = '44444444-4444-4444-8444-444444444444'
const MISSING_ID = '55555555-5555-4555-8555-555555555555'

const WIB_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Jam dinding WIB pada momen `minutesBefore` menit dari sekarang.
 *
 * Slot reminder diturunkan dari jam sungguhan supaya route test tidak bergantung pada
 * tanggal eksekusi dan tidak perlu memalsukan clock (fake timer merusak `app.inject`).
 * Matematika slot yang presisi sudah diuji terpisah di compliance.service.test.ts dengan
 * instant tetap.
 */
function timeOfDayMinutesAgo(minutesBefore: number): string {
  return WIB_FORMATTER.format(new Date(Date.now() - minutesBefore * 60_000))
}

/** `endDate: null` sengaja: itu nilai nyata dari kolom nullable `schedules.end_date`. */
function scheduleRow(patientId = PATIENT_ID, minutesBefore = 10) {
  return {
    id: SCHEDULE_ID,
    patientId,
    medicationId: '66666666-6666-4666-8666-666666666666',
    timeOfDay: timeOfDayMinutesAgo(minutesBefore),
    daysOfWeek: [],
    timeWindowMinutes: 30,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
    patient: { user: { timezone: 'Asia/Jakarta' } },
  }
}

describe('POST /v1/compliance/confirm (CL-107)', () => {
  let app: FastifyInstance
  let tokenPatient: string
  let tokenOther: string
  let tokenNakes: string

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false, enableWs: false })

    tokenPatient = app.jwt.sign({ sub: PATIENT_ID, role: 'PATIENT' })
    tokenOther = app.jwt.sign({ sub: OTHER_PATIENT_ID, role: 'PATIENT' })
    tokenNakes = app.jwt.sign({ sub: NAKES_ID, role: 'NAKES' })
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma))
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'audit-1' } as never)
    vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({ id: 'step-1' } as never)
    // Default: tidak ada eskalasi aktif dan belum ada log. Test yang butuh menimpanya.
    vi.spyOn(prisma.escalationRun, 'findFirst').mockResolvedValue(null as never)
    vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({
      id: 'log-default',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    } as never)
    // `transitionEscalationRun` membaca konteks pasien sebelum bertransisi.
    vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
      emergencyPreference: 'FAMILY_FIRST',
      livingSituation: 'WITH_FAMILY',
      familyContacts: [{ tier: 'TIER_1', isActive: true }],
    } as never)
  })

  function mockSchedule(row: unknown) {
    vi.spyOn(prisma.schedule, 'findUnique').mockResolvedValue(row as never)
  }

  function mockComplianceCreate(result: Record<string, unknown>) {
    return vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue(result as never)
  }

  async function confirm(token: string, payload: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/v1/compliance/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduleId: SCHEDULE_ID, ...payload },
    })
  }

  it('menolak tanpa token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/compliance/confirm', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('jadwal milik pasien lain → 403', async () => {
    mockSchedule(scheduleRow())

    const res = await confirm(tokenOther, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('FORBIDDEN')
    expect(res.json().error.message).toMatch(/bukan milik Anda/)
  })

  it('jadwal tidak ada → 404', async () => {
    mockSchedule(null)

    const res = await confirm(tokenPatient, { scheduleId: MISSING_ID, channel: 'IN_APP' })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('scheduleId bukan uuid → 400 VALIDATION_ERROR', async () => {
    const res = await confirm(tokenPatient, { scheduleId: 'bukan-uuid' })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('konfirmasi dalam time window → 200 CONFIRMED dan menulis compliance log', async () => {
    mockSchedule(scheduleRow(PATIENT_ID, 10))
    const create = mockComplianceCreate({
      id: 'log-1',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    })

    const res = await confirm(tokenPatient, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toMatchObject({
      logId: 'log-1',
      scheduleId: SCHEDULE_ID,
      status: 'CONFIRMED',
      escalationCancelled: false,
      escalationRunId: null,
    })
    expect(typeof body.data.scheduledAt).toBe('string')
    expect(Number.isNaN(Date.parse(body.data.scheduledAt))).toBe(false)

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduleId: SCHEDULE_ID,
          patientId: PATIENT_ID,
          status: 'CONFIRMED',
          channel: 'IN_APP',
          scheduledAt: new Date(body.data.scheduledAt),
        }),
      }),
    )
  })

  it('terlambat 2 jam → CONFIRMED_LATE, bukan MISSED (AC-2.3)', async () => {
    mockSchedule(scheduleRow(PATIENT_ID, 120))
    const create = mockComplianceCreate({
      id: 'log-2',
      status: 'CONFIRMED_LATE',
      confirmedAt: new Date(),
    })

    const res = await confirm(tokenPatient, { channel: 'WHATSAPP' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('CONFIRMED_LATE')
    expect(create.mock.calls[0][0].data.status).not.toBe('MISSED')
  })

  it('konfirmasi ganda → 409 ALREADY_PROCESSED tanpa menambah record', async () => {
    mockSchedule(scheduleRow())
    vi.spyOn(prisma.complianceLog, 'create').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['scheduleId', 'scheduledAt'] },
      }),
    )
    const findExisting = vi.spyOn(prisma.complianceLog, 'findUnique').mockResolvedValue({
      id: 'log-3',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    } as never)

    const res = await confirm(tokenPatient, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ALREADY_PROCESSED')
    // Record yang sudah ada dikembalikan, bukan ditulis ulang.
    expect(findExisting).toHaveBeenCalled()
    expect(prisma.complianceLog.create).toHaveBeenCalledTimes(1)
  })

  it('konfirmasi membatalkan run eskalasi aktif untuk jadwal tsb', async () => {
    mockSchedule(scheduleRow())
    mockComplianceCreate({ id: 'log-4', status: 'CONFIRMED', confirmedAt: new Date() })
    vi.spyOn(prisma.escalationRun, 'findFirst').mockResolvedValue({
      id: 'run-1',
      patientId: PATIENT_ID,
      sourceScheduleId: SCHEDULE_ID,
      status: 'WAITING_PATIENT',
      currentTier: null,
    } as never)
    const updateRun = vi
      .spyOn(prisma.escalationRun, 'update')
      .mockResolvedValue({ id: 'run-1', status: 'RESOLVED' } as never)
    vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
      id: 'run-1',
      patientId: PATIENT_ID,
      status: 'WAITING_PATIENT',
      currentTier: null,
      steps: [],
    } as never)
    vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({ id: 'step-1' } as never)

    const res = await confirm(tokenPatient, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ escalationCancelled: true, escalationRunId: 'run-1' })
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'RESOLVED', resolutionType: 'PATIENT_CONFIRMED' }),
      }),
    )
  })

  it('nakes ditolak: konfirmasi hanya boleh datang dari pasien sendiri', async () => {
    mockSchedule(scheduleRow(PATIENT_ID))

    const res = await confirm(tokenNakes, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('FORBIDDEN')
    // Tidak boleh ada jejak kepatuhan yang dibuat atas nama pasien.
    expect(prisma.complianceLog.create).not.toHaveBeenCalled()
  })

  it('channel default IN_APP saat tidak dikirim', async () => {
    mockSchedule(scheduleRow())
    const create = mockComplianceCreate({
      id: 'log-6',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    })

    const res = await confirm(tokenPatient)

    expect(res.statusCode).toBe(200)
    expect(create.mock.calls[0][0].data.channel).toBe('IN_APP')
  })

  it('jadwal tanpa slot jatuh tempo (baru mulai besok) → 422 tanpa menulis apa pun', async () => {
    mockSchedule({
      ...scheduleRow(),
      startDate: new Date(Date.now() + 86_400_000),
    })

    const res = await confirm(tokenPatient, { channel: 'IN_APP' })

    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_TRANSITION')
    expect(prisma.complianceLog.create).not.toHaveBeenCalled()
  })
})
