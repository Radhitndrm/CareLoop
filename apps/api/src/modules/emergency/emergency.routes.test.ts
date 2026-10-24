import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { EmergencyStatus, EmergencyTrigger } from '@careloop/shared'

describe('Emergency Routes (CL-204)', () => {
  let app: FastifyInstance
  const dummyEmergencyId = '33333333-3333-4333-8333-333333333333'
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false, enableWs: false })
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma))
    vi.spyOn(prisma.nakesAssignment, 'findMany').mockResolvedValue([] as any)
  })

  // Semua route darurat kini bertoken. Nakes dipakai sebagai aktor default;
  // kasus tanpa token & antar-role diuji di bagian RBAC di bawah.
  const nakesToken = (nakesRole = 'PERAWAT') =>
    app.jwt.sign({
      sub: '22222222-2222-4222-8222-222222222222',
      role: 'NAKES',
      nakesRole,
    } as any)

  const authHeaders = (nakesRole?: string) => ({
    authorization: `Bearer ${nakesToken(nakesRole)}`,
  })

  describe('GET /v1/emergencies/active', () => {
    it('mengembalikan daftar alert darurat aktif', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findMany').mockResolvedValue([
        {
          id: dummyEmergencyId,
          patientId: dummyPatientId,
          status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
          triggerType: EmergencyTrigger.ANOMALY_HR,
          hrBpm: 145,
          triggeredAt: new Date(),
          patient: {
            user: {
              id: 'user-1',
              fullName: 'Bu Siti Test',
              phone: '081234567890',
            },
          },
          escalationRun: {
            id: 'run-1',
            status: 'WAITING_PATIENT',
          },
        } as any,
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/v1/emergencies/active',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(dummyEmergencyId)
      expect(body.data[0].status).toBe(EmergencyStatus.PENDING_PATIENT_CONFIRM)
    })
  })

  describe('GET /v1/emergencies/:id', () => {
    it('mengembalikan detail alert jika ditemukan', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        triggerType: EmergencyTrigger.ANOMALY_HR,
        hrBpm: 145,
        triggeredAt: new Date(),
        patient: {
          user: {
            id: 'user-1',
            fullName: 'Bu Siti Test',
            phone: '081234567890',
          },
        },
        escalationRun: {
          id: 'run-1',
          status: 'WAITING_PATIENT',
          steps: [],
        },
      } as any)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/emergencies/${dummyEmergencyId}`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.id).toBe(dummyEmergencyId)
      expect(body.data.patient.user.fullName).toBe('Bu Siti Test')
    })

    it('mengembalikan 404 jika alert tidak ditemukan', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/emergencies/${dummyEmergencyId}`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('POST /v1/emergencies/:id/patient-response & /respond (CL-205)', () => {
    it('menerima respons SAFE dan mengembalikan status RESOLVED_SAFE', async () => {
      const existingAlert = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        notes: null,
        escalationRun: {
          id: 'run-1',
          status: 'WAITING_PATIENT',
          configSnapshot: { jobId: 'job-abc' },
        },
        patient: {
          id: dummyPatientId,
          user: { id: 'user-1', fullName: 'Bu Siti Test', phone: '081234567890' },
        },
      }

      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(existingAlert as any)
      vi.spyOn(prisma.emergencyAlert, 'update').mockImplementation((async ({ data }: any) => ({
        ...existingAlert,
        ...data,
      })) as any)
      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue(existingAlert.patient as any)
      let runStatus = 'WAITING_PATIENT'
      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async () => ({
        id: 'run-1',
        patientId: dummyPatientId,
        status: runStatus,
        steps: [],
      })) as any)
      vi.spyOn(prisma.escalationRun, 'update').mockImplementation((async ({ data }: any) => {
        runStatus = data.status
        return { id: 'run-1', patientId: dummyPatientId, status: runStatus, steps: [] } as any
      }) as any)
      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${dummyEmergencyId}/patient-response`,
        headers: authHeaders(),
        payload: {
          response: 'SAFE',
          notes: 'Saya aman',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.status).toBe(EmergencyStatus.RESOLVED_SAFE)
      expect(body.data.patientConfirmedSafe).toBe(true)
    })

    it('menerima respons NEED_HELP via alias route /respond dan mengembalikan status ESCALATING', async () => {
      const existingAlert = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        notes: null,
        escalationRun: {
          id: 'run-1',
          patientId: dummyPatientId,
          status: 'WAITING_PATIENT',
          currentTier: null,
          configSnapshot: { jobId: 'job-abc' },
        },
        patient: {
          id: dummyPatientId,
          emergencyPreference: 'FAMILY_FIRST',
          user: { id: 'user-1', fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [{ tier: 'TIER_1', isActive: true }],
        },
      }

      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(existingAlert as any)
      vi.spyOn(prisma.emergencyAlert, 'update').mockImplementation((async ({ data }: any) => ({
        ...existingAlert,
        ...data,
      })) as any)
      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue(existingAlert.patient as any)
      let needHelpStatus = 'WAITING_PATIENT'
      let needHelpTier: any = null
      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async () => ({
        id: 'run-1',
        patientId: dummyPatientId,
        status: needHelpStatus,
        currentTier: needHelpTier,
        steps: [],
      })) as any)
      vi.spyOn(prisma.escalationRun, 'update').mockImplementation((async ({ data }: any) => {
        needHelpStatus = data.status
        needHelpTier = data.currentTier
        return { id: 'run-1', patientId: dummyPatientId, status: needHelpStatus, currentTier: needHelpTier, steps: [] } as any
      }) as any)
      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${dummyEmergencyId}/respond`,
        headers: authHeaders(),
        payload: {
          response: 'NEED_HELP',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.status).toBe(EmergencyStatus.ESCALATING)
      expect(body.data.patientConfirmedSafe).toBe(false)
    })

    it('menolak payload dengan nilai response tidak valid (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${dummyEmergencyId}/respond`,
        headers: authHeaders(),
        payload: {
          response: 'INVALID_STATUS',
        },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /v1/emergencies/:id/timeout (CL-206)', () => {
    it('menerima pemicu timeout dan mengembalikan status ESCALATING dengan lokasi GPS (AC-4.3)', async () => {
      const existingAlert = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        hrBpm: 138,
        notes: null,
        patient: {
          id: dummyPatientId,
          livingSituation: 'WITH_FAMILY',
          lastKnownLat: -6.2088,
          lastKnownLng: 106.8456,
          user: { id: 'user-1', fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [
            { id: 'fc-1', name: 'Dewi (Anak)', phone: '081299998888', tier: 'TIER_1', priority: 1, isActive: true },
          ],
          nakesContacts: [],
        },
        escalationRun: {
          id: 'run-timeout-1',
          status: 'WAITING_PATIENT',
          steps: [],
        },
      }

      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(existingAlert as any)
      vi.spyOn(prisma.emergencyAlert, 'update').mockImplementation((async ({ data }: any) => ({
        ...existingAlert,
        ...data,
      })) as any)
      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue(existingAlert.patient as any)
      let timeoutRunStatus = 'WAITING_PATIENT'
      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async () => ({
        id: 'run-timeout-1',
        patientId: dummyPatientId,
        status: timeoutRunStatus,
        steps: [],
      })) as any)
      vi.spyOn(prisma.escalationRun, 'update').mockImplementation((async ({ data }: any) => {
        timeoutRunStatus = data.status
        return { id: 'run-timeout-1', patientId: dummyPatientId, status: timeoutRunStatus, steps: [] } as any
      }) as any)
      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.notification, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${dummyEmergencyId}/timeout`,
        headers: authHeaders(),
        payload: {
          notes: 'Uji timeout via HTTP',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.emergencyId).toBe(dummyEmergencyId)
      expect(body.data.status).toBe(EmergencyStatus.ESCALATING)
      expect(body.data.hasLocation).toBe(true)
      expect(body.data.locationLat).toBe('-6.2088')
      expect(body.data.tel112).toBe('tel:112')
      expect(body.data.notifiedFamilyCount).toBe(1)
    })

    it('menolak ID non-UUID dengan 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/emergencies/non-uuid-id/timeout',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(400)
    })

    it('mengembalikan 404 jika alert darurat tidak ditemukan', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${dummyEmergencyId}/timeout`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('POST /internal/jobs/escalation-timeout (CL-206 & CL-110)', () => {
    it('memproses timeout untuk run dengan context EMERGENCY', async () => {
      const runId = '55555555-5555-4555-8555-555555555555'
      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async ({ where }: any) => {
        if (where.id === runId) {
          return {
            id: runId,
            status: 'WAITING_PATIENT',
            context: 'EMERGENCY',
            patientId: dummyPatientId,
          } as any
        }
        return null
      }) as any)

      vi.spyOn(prisma.emergencyAlert, 'findFirst').mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        notes: null,
        patient: {
          id: dummyPatientId,
          livingSituation: 'WITH_FAMILY',
          user: { id: 'user-1', fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [
            { id: 'fc-1', name: 'Dewi (Anak)', phone: '081299998888', tier: 'TIER_1', priority: 1, isActive: true },
          ],
          nakesContacts: [],
        },
        escalationRun: {
          id: runId,
          status: 'WAITING_PATIENT',
          steps: [],
        },
      } as any)
      vi.spyOn(prisma.emergencyAlert, 'update').mockResolvedValue({} as any)
      vi.spyOn(prisma.escalationRun, 'update').mockResolvedValue({} as any)
      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
        id: dummyPatientId,
        emergencyPreference: 'FAMILY_FIRST',
        livingSituation: 'WITH_FAMILY',
        familyContacts: [{ tier: 'TIER_1', isActive: true }],
      } as any)
      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.notification, 'create').mockResolvedValue({} as any)
      vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as any)

      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        headers: authHeaders(),
        payload: {
          runId,
          currentState: 'WAITING_PATIENT',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.runId).toBe(runId)
      expect(body.data.emergencyResult).toBeDefined()
    })

    it('mengembalikan 422 jika status run sudah berubah (idempoten)', async () => {
      const runId = '55555555-5555-4555-8555-555555555555'
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: runId,
        status: 'RESOLVED',
        context: 'EMERGENCY',
      } as any)

      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        headers: authHeaders(),
        payload: {
          runId,
          currentState: 'WAITING_PATIENT',
        },
      })

      expect(res.statusCode).toBe(422)
      const body = res.json()
      expect(body.error.code).toBe('STATE_CHANGED')
    })
  })
})
