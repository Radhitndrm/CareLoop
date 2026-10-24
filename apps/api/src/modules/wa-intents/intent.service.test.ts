// CL-112 — kontrak dispatcher intent: intent mana memanggil service mana, dengan argumen apa,
// dan siapa yang-boleh menjawab. Fokus test ini adalah wiring & guard; perilaku tiap service
// domain sudah punya test sendiri (compliance, emergency, escalation).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WaButtonIntent } from '../../integrations/whatsapp/parser'

const confirmMedicationIntake = vi.fn()
const deferMedicationIntake = vi.fn()
const handlePatientEmergencyResponse = vi.fn()
const handleEscalationRun = vi.fn()

vi.mock('../compliance/compliance.service', () => ({
  confirmMedicationIntake: (...args: unknown[]) => confirmMedicationIntake(...args),
  deferMedicationIntake: (...args: unknown[]) => deferMedicationIntake(...args),
}))

vi.mock('../emergency/emergency.service', () => ({
  handlePatientEmergencyResponse: (...args: unknown[]) => handlePatientEmergencyResponse(...args),
}))

vi.mock('../escalation/escalation.service', () => ({
  handleEscalationRun: (...args: unknown[]) => handleEscalationRun(...args),
}))

import { dispatchWaIntent, resourceTypeForIntent, resolveEscalationActor } from './intent.service'

const PATIENT_PHONE = '081200000002'
const OTHER_PHONE = '081399999999'
const SCHEDULE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const EMERGENCY_ID = 'cccccccc-3333-4333-8333-333333333333'
const RUN_ID = 'dddddddd-4444-4444-8444-444444444444'

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    schedule: {
      findUnique: vi.fn().mockResolvedValue({
        id: SCHEDULE_ID,
        patientId: 'patient-1',
        patient: { user: { id: 'patient-1', phone: PATIENT_PHONE } },
      }),
    },
    emergencyAlert: {
      findUnique: vi.fn().mockResolvedValue({
        id: EMERGENCY_ID,
        patientId: 'patient-1',
        patient: { user: { id: 'patient-1', phone: PATIENT_PHONE } },
      }),
    },
    escalationRun: {
      findUnique: vi.fn().mockResolvedValue({ id: RUN_ID, patientId: 'patient-1', status: 'FAMILY_TIER_1' }),
    },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    familyContact: { findMany: vi.fn().mockResolvedValue([]) },
    nakesContact: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  }
}

function deps(prisma = fakePrisma()) {
  return { prisma: prisma as any }
}

describe('dispatchWaIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMedicationIntake.mockResolvedValue({
      log: { id: 'log-1' },
      scheduledAt: new Date('2026-01-01T00:00:00Z'),
      status: 'CONFIRMED',
      escalationRunId: null,
      escalationResolved: false,
    })
    deferMedicationIntake.mockImplementation(async (_client: unknown, input: any, deps: any) => {
      const reminderJobId = deps?.enqueueReminder
        ? await deps.enqueueReminder({
            scheduleId: input.scheduleId,
            dueAt: new Date('2026-01-01T00:15:00Z'),
          })
        : null
      return {
        log: { id: 'log-2' },
        scheduledAt: new Date('2026-01-01T00:00:00Z'),
        deferredUntil: new Date('2026-01-01T00:15:00Z'),
        minutes: 15,
        reminderJobId,
        escalationRunId: 'run-1',
        alreadyDeferred: false,
      }
    })
    handlePatientEmergencyResponse.mockResolvedValue({
      emergencyId: EMERGENCY_ID,
      status: 'ESCALATING',
      patientConfirmedSafe: false,
      patientConfirmedAt: new Date(),
      escalationRunId: 'run-2',
      escalationStatus: 'FAMILY_TIER_1',
    })
    handleEscalationRun.mockResolvedValue({
      run: { id: RUN_ID, status: 'HANDLED', currentTier: 'FAMILY_TIER_1', resolutionType: 'FAMILY_HANDLED' },
      transition: { to: 'HANDLED', notify: [] },
    })
  })

  it('CONFIRM_TAKEN memanggil confirmMedicationIntake lewat channel WHATSAPP', async () => {
    const result = await dispatchWaIntent(deps(), {
      intent: WaButtonIntent.CONFIRM_TAKEN,
      resourceId: SCHEDULE_ID,
      actorPhone: PATIENT_PHONE,
      sourceMessageId: 'mock_1',
    })

    expect(confirmMedicationIntake).toHaveBeenCalledTimes(1)
    expect(confirmMedicationIntake.mock.calls[0][1]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      channel: 'WHATSAPP',
      sourceMessageId: 'mock_1',
    })
    expect(result.resourceType).toBe('schedule')
    expect(result.outcome).toBe('CONFIRMED')
  })

  it('DEFER memanggil deferMedicationIntake, bukan confirm', async () => {
    const result = await dispatchWaIntent(deps(), {
      intent: WaButtonIntent.DEFER,
      resourceId: SCHEDULE_ID,
      actorPhone: PATIENT_PHONE,
    })

    expect(deferMedicationIntake).toHaveBeenCalledTimes(1)
    expect(confirmMedicationIntake).not.toHaveBeenCalled()
    expect(result.outcome).toBe('TUNDA')
  })

  it('DEFER meneruskan queue reminder susulan lewat deps', async () => {
    const schedule = vi.fn().mockResolvedValue('job-77')
    await dispatchWaIntent(
      { prisma: fakePrisma() as any, reminderQueue: { schedule } as any },
      { intent: WaButtonIntent.DEFER, resourceId: SCHEDULE_ID, actorPhone: PATIENT_PHONE },
    )

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule.mock.calls[0][0]).toMatchObject({ scheduleId: SCHEDULE_ID })
    expect(schedule.mock.calls[0][2].jobId).toContain('defer')
  })

  it('SAFE & NEED_HELP memanggil handlePatientEmergencyResponse dengan respons yang benar', async () => {
    await dispatchWaIntent(deps(), {
      intent: WaButtonIntent.SAFE,
      resourceId: EMERGENCY_ID,
      actorPhone: PATIENT_PHONE,
    })
    expect(handlePatientEmergencyResponse.mock.calls[0][1]).toMatchObject({ response: 'SAFE' })

    vi.clearAllMocks()
    await dispatchWaIntent(deps(), {
      intent: WaButtonIntent.NEED_HELP,
      resourceId: EMERGENCY_ID,
      actorPhone: PATIENT_PHONE,
    })
    expect(handlePatientEmergencyResponse.mock.calls[0][1]).toMatchObject({ response: 'NEED_HELP' })
  })

  it('HANDLE dari kontak keluarga memakai event FAMILY_HANDLED', async () => {
    const prisma = fakePrisma({
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-sari', role: 'FAMILY' }) },
    })

    const result = await dispatchWaIntent(deps(prisma), {
      intent: WaButtonIntent.HANDLE,
      resourceId: RUN_ID,
      actorPhone: '081300000002',
    })

    expect(handleEscalationRun.mock.calls[0][1]).toMatchObject({
      runId: RUN_ID,
      actorUserId: 'user-sari',
      actorRole: 'FAMILY',
    })
    expect(result.outcome).toBe('HANDLED')
  })

  it('HANDLE dari nomor yang bukan kontak pasien ditolak 403', async () => {
    await expect(
      dispatchWaIntent(deps(), {
        intent: WaButtonIntent.HANDLE,
        resourceId: RUN_ID,
        actorPhone: OTHER_PHONE,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(handleEscalationRun).not.toHaveBeenCalled()
  })

  it('HANDLE tanpa nomor pengirim ditolak — tidak boleh menutup alarm tanpa tahu identitas', async () => {
    await expect(
      dispatchWaIntent(deps(), { intent: WaButtonIntent.HANDLE, resourceId: RUN_ID }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reply dari nomor yang bukan pemilik resource ditolak 403', async () => {
    await expect(
      dispatchWaIntent(deps(), {
        intent: WaButtonIntent.CONFIRM_TAKEN,
        resourceId: SCHEDULE_ID,
        actorPhone: OTHER_PHONE,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(confirmMedicationIntake).not.toHaveBeenCalled()
  })

  it('intent tanpa resource id ditolak, bukan diproses asal jalan', async () => {
    await expect(
      dispatchWaIntent(deps(), { intent: WaButtonIntent.CONFIRM_TAKEN, resourceId: null }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('error domain diteruskan apa adanya (409/403 tidak ditelan dispatcher)', async () => {
    confirmMedicationIntake.mockRejectedValueOnce(
      Object.assign(new Error('sudah dikonfirmasi'), { statusCode: 409, code: 'ALREADY_PROCESSED' }),
    )

    await expect(
      dispatchWaIntent(deps(), {
        intent: WaButtonIntent.CONFIRM_TAKEN,
        resourceId: SCHEDULE_ID,
        actorPhone: PATIENT_PHONE,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('peta intent → jenis resource sesuai kontrak button id', () => {
    expect(resourceTypeForIntent(WaButtonIntent.CONFIRM_TAKEN)).toBe('schedule')
    expect(resourceTypeForIntent(WaButtonIntent.DEFER)).toBe('schedule')
    expect(resourceTypeForIntent(WaButtonIntent.SAFE)).toBe('emergency')
    expect(resourceTypeForIntent(WaButtonIntent.NEED_HELP)).toBe('emergency')
    expect(resourceTypeForIntent(WaButtonIntent.HANDLE)).toBe('escalation')
  })
})

describe('resolveEscalationActor', () => {
  it('mengaku user lebih dulu, lalu kontak keluarga, lalu kontak nakes', async () => {
    const prisma = fakePrisma({
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', role: 'NAKES' }) },
    })
    await expect(resolveEscalationActor(prisma as any, 'patient-1', '081100000001')).resolves.toEqual({
      userId: 'u1',
      role: 'NAKES',
    })

    const withoutUser = fakePrisma({
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      familyContact: {
        findMany: vi.fn().mockResolvedValue([{ phone: '081300000002', userId: 'user-sari' }]),
      },
    })
    await expect(
      resolveEscalationActor(withoutUser as any, 'patient-1', '081300000002'),
    ).resolves.toEqual({ userId: 'user-sari', role: 'FAMILY' })

    const nakesOnly = fakePrisma({
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      nakesContact: {
        findMany: vi.fn().mockResolvedValue([{ phone: '081100000002', nakesUserId: 'user-nakes' }]),
      },
    })
    await expect(
      resolveEscalationActor(nakesOnly as any, 'patient-1', '081100000002'),
    ).resolves.toEqual({ userId: 'user-nakes', role: 'NAKES' })
  })

  it('kontak keluarga tanpa akun user tetap dikenali (userId null, bukan id orang lain)', async () => {
    const prisma = fakePrisma({
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      familyContact: { findMany: vi.fn().mockResolvedValue([{ phone: '081300000002', userId: null }]) },
    })
    await expect(
      resolveEscalationActor(prisma as any, 'patient-1', '081300000002'),
    ).resolves.toEqual({ userId: null, role: 'FAMILY' })
  })
})