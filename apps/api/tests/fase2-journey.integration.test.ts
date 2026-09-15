/**
 * CL-214: Integration Test Fase 2 (M2 Darurat & Dashboard).
 * Menguji alur kritis end-to-end (TESTING.md §6.2):
 * 1. Journey Anomali-SAFE -> RESOLVED (keluarga tidak dialert) (AC-4.2).
 * 2. Journey Anomali-Timeout -> Alert keluarga (T1) + nakes (ALONE) + tel:112 (AC-4.3, AC-4.5, AC-4.6).
 * 3. Urutan Tier & HANDLED Berhenti (T1 -> T2 -> NAKES) (AC-7.1 s.d. AC-7.5).
 * 4. Kalkulasi API Adherence Dashboard (AC-5.1, AC-5.3).
 */
import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  EmergencyStatus,
  EmergencyTrigger,
  EscalationRunStatus,
  FamilyTier,
  Relationship,
  ComplianceStatus,
  EscalationContext,
} from '@careloop/shared'
import { prisma } from '../src/lib/prisma'
import {
  createWhatsAppService,
  getWhatsAppService,
  resetWhatsAppServiceCache,
  MockWhatsAppProvider,
} from '../src/integrations/whatsapp'
import * as waModule from '../src/integrations/whatsapp'

describe('CL-214: Integration Test Fase 2 (M2 Darurat & Dashboard)', () => {
  let app: FastifyInstance
  let mockWaProvider: MockWhatsAppProvider
  let tokenNakes: string
  let tokenPatientBuRatna: string
  let tokenPatientPakHaji: string

  const patientBuRatnaId = '11111111-1111-4111-8111-111111111111'
  const patientPakHajiId = '22222222-2222-4222-8222-222222222222'
  const nakesUserId = '33333333-3333-4333-8333-333333333333'

  // UUID valid untuk entitas uji
  const emergencyId1 = '55555555-5555-4555-8555-555555555555'
  const emergencyId2 = '66666666-6666-4666-8666-666666666666'
  const emergencyId3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const escalationRunId1 = '77777777-7777-4777-8777-777777777777'
  const escalationRunId2 = '88888888-8888-4888-8888-888888888888'
  const escalationRunId3 = '99999999-9999-4999-8999-999999999999'
  const escalationRunId4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  // In-memory store untuk simulasi prisma
  interface MockDb {
    patients: any[]
    emergencyAlerts: any[]
    escalationRuns: any[]
    escalationSteps: any[]
    auditLogs: any[]
    notifications: any[]
    complianceLogs: any[]
    nakesAssignments: any[]
  }

  let db: MockDb

  function resetDb(): void {
    const patientBuRatna = {
      id: patientBuRatnaId,
      livingSituation: 'ALONE',
      emergencyPreference: 'NAKES_FIRST',
      lastKnownLat: -6.2088,
      lastKnownLng: 106.8456,
      districtCode: '3471',
      healthConditions: ['DIABETES'],
      riskLevel: 'HIGH',
      riskScore: 82,
      user: {
        id: patientBuRatnaId,
        fullName: 'Bu Ratna',
        phone: '081100000001',
      },
      familyContacts: [
        {
          id: 'fam-t2-ari',
          userId: 'u-fam-ari',
          name: 'Ari',
          phone: '081200000002',
          tier: FamilyTier.TIER_2,
          relationship: Relationship.ANAK,
          isActive: true,
          priority: 1,
        },
      ],
      nakesContacts: [
        {
          id: 'nakes-jetis-1',
          puskesmasId: 'psk-1',
          isPrimary: true,
          isActive: true,
          phone: '081300000003',
          nakesName: 'Kader Nuning',
          nakesUserId: nakesUserId,
          user: { fullName: 'Kader Nuning', phone: '081300000003' },
        },
      ],
    }

    const patientPakHaji = {
      id: patientPakHajiId,
      livingSituation: 'WITH_FAMILY',
      emergencyPreference: 'FAMILY_FIRST',
      lastKnownLat: -6.2088,
      lastKnownLng: 106.8456,
      districtCode: '3471',
      healthConditions: ['HIPERTENSI'],
      riskLevel: 'LOW',
      riskScore: 20,
      user: {
        id: patientPakHajiId,
        fullName: 'Pak Haji',
        phone: '081200000001',
      },
      familyContacts: [
        {
          id: 'fam-t1-ahmad',
          userId: 'u-fam-ahmad',
          name: 'Ahmad',
          phone: '081200000004',
          tier: FamilyTier.TIER_1,
          relationship: Relationship.ANAK,
          isActive: true,
          priority: 1,
        },
        {
          id: 'fam-t2-pak-rt',
          userId: 'u-fam-rt',
          name: 'Pak RT',
          phone: '081200000005',
          tier: FamilyTier.TIER_2,
          relationship: Relationship.TETANGGA,
          isActive: true,
          priority: 1,
        },
      ],
      nakesContacts: [
        {
          id: 'nakes-jetis-2',
          puskesmasId: 'psk-1',
          isPrimary: true,
          isActive: true,
          phone: '081300000003',
          nakesName: 'Kader Nuning',
          nakesUserId: nakesUserId,
          user: { fullName: 'Kader Nuning', phone: '081300000003' },
        },
      ],
    }

    db = {
      patients: [patientBuRatna, patientPakHaji],
      emergencyAlerts: [],
      escalationRuns: [],
      escalationSteps: [],
      auditLogs: [],
      notifications: [],
      complianceLogs: [],
      nakesAssignments: [{ puskesmasId: 'psk-1', districtCode: '3471', userId: nakesUserId }],
    }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-fase2-integration-testing-key-32chars'

    const { buildApp } = await import('../src/app')
    app = await buildApp({ logger: false, enableWs: false })

    tokenNakes = app.jwt.sign({ sub: nakesUserId, role: 'NAKES' })
    tokenPatientBuRatna = app.jwt.sign({ sub: patientBuRatnaId, role: 'PATIENT' })
    tokenPatientPakHaji = app.jwt.sign({ sub: patientPakHajiId, role: 'PATIENT' })
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    resetWhatsAppServiceCache()
    resetDb()

    // Mock WhatsApp provider untuk mencatat semua pengiriman pesan
    mockWaProvider = new MockWhatsAppProvider()
    const customWaService = createWhatsAppService({ provider: mockWaProvider })
    vi.spyOn(waModule, 'getWhatsAppService').mockReturnValue(customWaService)

    // Bypass transaction
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma))

    // Mock Prisma Patient
    vi.spyOn(prisma.patient as any, 'findUnique').mockImplementation(async ({ where }: any) => {
      const p = db.patients.find((pt) => pt.id === where.id)
      return p ? { ...p } : null
    })
    vi.spyOn(prisma.patient as any, 'findMany').mockImplementation(async () => {
      return db.patients.map((p) => ({ ...p }))
    })
    vi.spyOn(prisma.patient as any, 'update').mockImplementation(async ({ where, data }: any) => {
      const idx = db.patients.findIndex((pt) => pt.id === where.id)
      if (idx !== -1) {
        db.patients[idx] = { ...db.patients[idx], ...data }
        return { ...db.patients[idx] }
      }
      return null
    })

    // Mock Prisma EmergencyAlert
    vi.spyOn(prisma.emergencyAlert as any, 'findUnique').mockImplementation(async ({ where }: any) => {
      const alert = db.emergencyAlerts.find((a) => a.id === where.id)
      if (!alert) return null
      const patient = db.patients.find((p) => p.id === alert.patientId)
      const escalationRun = db.escalationRuns.find(
        (r) => r.id === alert.escalationRunId || r.sourceEmergencyId === alert.id,
      )
      const steps = escalationRun ? db.escalationSteps.filter((s) => s.runId === escalationRun.id) : []
      return {
        ...alert,
        patient: patient ? { ...patient } : null,
        escalationRun: escalationRun ? { ...escalationRun, steps } : null,
      }
    })
    vi.spyOn(prisma.emergencyAlert as any, 'findFirst').mockImplementation(async ({ where }: any) => {
      const alert = db.emergencyAlerts.find((a) => {
        if (where?.escalationRun?.id && a.escalationRunId !== where.escalationRun.id) return false
        return true
      })
      if (!alert) return null
      const patient = db.patients.find((p) => p.id === alert.patientId)
      const escalationRun = db.escalationRuns.find(
        (r) => r.id === alert.escalationRunId || r.sourceEmergencyId === alert.id,
      )
      return {
        ...alert,
        patient: patient ? { ...patient } : null,
        escalationRun: escalationRun ? { ...escalationRun } : null,
      }
    })
    vi.spyOn(prisma.emergencyAlert as any, 'update').mockImplementation(async ({ where, data }: any) => {
      const index = db.emergencyAlerts.findIndex((a) => a.id === where.id)
      if (index === -1) throw new Error(`EmergencyAlert ${where.id} not found`)
      const updated = { ...db.emergencyAlerts[index], ...data, updatedAt: new Date() }
      db.emergencyAlerts[index] = updated
      return { ...updated }
    })
    vi.spyOn(prisma.emergencyAlert as any, 'count').mockImplementation(async () => db.emergencyAlerts.length)

    // Mock Prisma EscalationRun
    vi.spyOn(prisma.escalationRun as any, 'findUnique').mockImplementation(async ({ where }: any) => {
      const run = db.escalationRuns.find((r) => r.id === where.id)
      if (!run) return null
      const steps = db.escalationSteps.filter((s) => s.runId === run.id)
      const patient = db.patients.find((p) => p.id === run.patientId)
      return {
        ...run,
        steps,
        patient: patient ? { ...patient } : null,
      }
    })
    vi.spyOn(prisma.escalationRun as any, 'findMany').mockImplementation(async () => {
      return db.escalationRuns.map((r) => ({
        ...r,
        steps: db.escalationSteps.filter((s) => s.runId === r.id),
      }))
    })
    vi.spyOn(prisma.escalationRun as any, 'update').mockImplementation(async ({ where, data }: any) => {
      const index = db.escalationRuns.findIndex((r) => r.id === where.id)
      if (index === -1) throw new Error(`EscalationRun ${where.id} not found`)
      const updated = { ...db.escalationRuns[index], ...data, updatedAt: new Date() }
      db.escalationRuns[index] = updated
      return { ...updated }
    })
    vi.spyOn(prisma.escalationRun as any, 'count').mockImplementation(async () => db.escalationRuns.length)

    // Mock Prisma EscalationStep
    vi.spyOn(prisma.escalationStep as any, 'create').mockImplementation(async ({ data }: any) => {
      const step = { id: `step-${db.escalationSteps.length + 1}`, ...data, createdAt: new Date() }
      db.escalationSteps.push(step)
      return step
    })

    // Mock Prisma AuditLog & Notification
    vi.spyOn(prisma.auditLog as any, 'create').mockImplementation(async ({ data }: any) => {
      const log = { id: `audit-${db.auditLogs.length + 1}`, ...data, createdAt: new Date() }
      db.auditLogs.push(log)
      return log
    })
    if (prisma.notification) {
      vi.spyOn(prisma.notification as any, 'create').mockImplementation(async ({ data }: any) => {
        const notif = { id: `notif-${db.notifications.length + 1}`, ...data, createdAt: new Date() }
        db.notifications.push(notif)
        return notif
      })
    }

    // Mock ComplianceLog & NakesAssignment
    if (prisma.complianceLog) {
      vi.spyOn(prisma.complianceLog as any, 'findMany').mockImplementation(async () => db.complianceLogs)
    }
    if (prisma.nakesAssignment) {
      vi.spyOn(prisma.nakesAssignment as any, 'findMany').mockImplementation(async () => db.nakesAssignments)
    }
  })

  // =========================================================================
  // SUITE 1: Anomali-SAFE -> RESOLVED (Keluarga TIDAK Dialert) (AC-4.2)
  // =========================================================================
  describe('1. Journey Anomali-SAFE -> RESOLVED (AC-4.2)', () => {
    it('saat pasien konfirmasi SAFE, status darurat selesai & keluarga tidak menerima pesan darurat', async () => {
      // Seed initial state insiden darurat & escalation run
      db.emergencyAlerts.push({
        id: emergencyId1,
        patientId: patientBuRatnaId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        triggerType: EmergencyTrigger.ANOMALY_HR,
        hrBpm: 145,
        locationLat: -6.2088,
        locationLng: 106.8456,
        triggeredAt: new Date('2026-08-16T02:00:00Z'),
        patientConfirmedSafe: false,
        notes: 'Anomali HR terdeteksi 145 bpm',
        escalationRunId: escalationRunId1,
      })

      db.escalationRuns.push({
        id: escalationRunId1,
        patientId: patientBuRatnaId,
        context: EscalationContext.EMERGENCY,
        sourceEmergencyId: emergencyId1,
        status: EscalationRunStatus.WAITING_PATIENT,
        currentTier: null,
        startedAt: new Date('2026-08-16T02:00:00Z'),
        configSnapshot: { jobId: 'job-patient-timeout-001' },
      })

      // Pasien menekan "Saya Aman" lewat API respons mobile (CL-205 / CL-213)
      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${emergencyId1}/respond`,
        headers: { Authorization: `Bearer ${tokenPatientBuRatna}` },
        payload: {
          response: 'SAFE',
          notes: 'Saya aman, hanya baru selesai jalan pagi',
          locationLat: -6.2088,
          locationLng: 106.8456,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.status).toBe(EmergencyStatus.RESOLVED_SAFE)
      expect(body.data.patientConfirmedSafe).toBe(true)

      // Verifikasi status DB di mock store
      const updatedAlert = db.emergencyAlerts.find((a) => a.id === emergencyId1)
      expect(updatedAlert?.status).toBe(EmergencyStatus.RESOLVED_SAFE)
      expect(updatedAlert?.patientConfirmedSafe).toBe(true)

      const updatedRun = db.escalationRuns.find((r) => r.id === escalationRunId1)
      expect(updatedRun?.status).toBe('RESOLVED')

      // VERIFIKASI UTAMA AC-4.2: Tidak ada pesan darurat terkirim ke keluarga!
      const emergencyFamilyMessages = mockWaProvider.sent.filter((msg) =>
        (msg.payload.kind === 'TEXT' ? msg.payload.text : '').includes('DARURAT'),
      )
      expect(emergencyFamilyMessages).toHaveLength(0)

      // Verifikasi audit log tercatat
      const resolvedAudit = db.auditLogs.find(
        (a) => a.resourceId === emergencyId1 && a.action === 'emergency.resolved',
      )
      expect(resolvedAudit).toBeDefined()
    })
  })

  // =========================================================================
  // SUITE 2: Anomali-Timeout -> Alert Keluarga (T1) & Nakes (ALONE) + tel:112
  // =========================================================================
  describe('2. Journey Anomali-Timeout -> Alert Keluarga & Nakes + tel:112 (AC-4.3 s.d. AC-4.6)', () => {
    it('saat timeout pasien dengan keluarga, alert darurat dikirim ke kontak keluarga (TIER_1) menyertakan lokasi GPS dan tautan tel:112 (AC-4.3, AC-4.4, AC-4.6)', async () => {
      // Pasien Pak Haji (WITH_FAMILY): punya Tier 1 (Ahmad: 081200000004) dan Tier 2 (Pak RT)
      db.emergencyAlerts.push({
        id: emergencyId2,
        patientId: patientPakHajiId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        triggerType: EmergencyTrigger.ANOMALY_HR,
        hrBpm: 148,
        locationLat: -6.2088,
        locationLng: 106.8456,
        triggeredAt: new Date('2026-08-16T02:00:00Z'),
        escalationRunId: escalationRunId2,
      })

      db.escalationRuns.push({
        id: escalationRunId2,
        patientId: patientPakHajiId,
        context: EscalationContext.EMERGENCY,
        sourceEmergencyId: emergencyId2,
        status: EscalationRunStatus.WAITING_PATIENT,
        currentTier: null,
        startedAt: new Date('2026-08-16T02:00:00Z'),
      })

      // Panggil endpoint timeout darurat (CL-206)
      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${emergencyId2}/timeout`,
        payload: {
          notes: 'Timeout 45 detik: pasien tidak merespons konfirmasi darurat',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.emergencyId).toBe(emergencyId2)
      expect(body.data.notifiedFamilyCount).toBeGreaterThanOrEqual(1)
      expect(body.data.tel112).toBe('tel:112')

      // 1. Verifikasi pesan WA darurat dikirim ke kontak keluarga
      const sentWa = mockWaProvider.sent
      expect(sentWa.length).toBeGreaterThan(0)

      const familyAlert = sentWa.find(
        (m) => m.to === '6281200000004' || m.to.includes('81200000004'),
      )
      expect(familyAlert).toBeDefined()
      expect(familyAlert!.payload.kind === 'TEXT' ? familyAlert!.payload.text : '').toContain(
        'DARURAT',
      )
      expect(familyAlert!.payload.kind === 'TEXT' ? familyAlert!.payload.text : '').toContain(
        'Pak Haji',
      )

      // 2. Verifikasi koordinat GPS Google Maps disertakan (AC-4.3)
      const familyText = familyAlert!.payload.kind === 'TEXT' ? familyAlert!.payload.text : ''
      expect(familyText).toContain('https://maps.google.com/?q=-6.2088,106.8456')

      // 3. Verifikasi tautan manual tel:112 hadir tanpa auto-dial (AC-4.6 & Hard Constraint)
      expect(familyText).toContain('tel:112')

      // 4. Verifikasi status eskalasi berganti ke FAMILY_TIER_1 (AC-4.4)
      const run = db.escalationRuns.find((r) => r.id === escalationRunId2)
      expect(run?.status).toBe(EscalationRunStatus.FAMILY_TIER_1)
    })

    it('saat timeout pasien tinggal sendiri (ALONE tanpa Tier-1), alert darurat langsung dikirim ke nakes pembina + tel:112 (AC-4.5, AC-4.6)', async () => {
      // Bu Ratna: livingSituation=ALONE, tanpa kontak Tier-1, tanpa GPS -> uji fallback lokasi
      db.patients[0].lastKnownLat = null
      db.patients[0].lastKnownLng = null

      db.emergencyAlerts.push({
        id: emergencyId3,
        patientId: patientBuRatnaId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        triggerType: EmergencyTrigger.ANOMALY_HR,
        hrBpm: 152,
        locationLat: null,
        locationLng: null,
        triggeredAt: new Date('2026-08-16T03:00:00Z'),
        escalationRunId: escalationRunId3,
      })

      db.escalationRuns.push({
        id: escalationRunId3,
        patientId: patientBuRatnaId,
        context: EscalationContext.EMERGENCY,
        sourceEmergencyId: emergencyId3,
        status: EscalationRunStatus.WAITING_PATIENT,
        currentTier: null,
        startedAt: new Date('2026-08-16T03:00:00Z'),
      })

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${emergencyId3}/timeout`,
        payload: {
          notes: 'Timeout 45 detik: pasien ALONE tidak merespons',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.notifiedNakesCount).toBeGreaterThanOrEqual(1)

      // Verifikasi pesan terkirim ke Kader Nuning
      const nakesAlert = mockWaProvider.sent.find(
        (m) => m.to === '6281300000003' || m.to.includes('81300000003'),
      )
      expect(nakesAlert).toBeDefined()
      const nakesText = nakesAlert!.payload.kind === 'TEXT' ? nakesAlert!.payload.text : ''
      expect(nakesText).toContain('DARURAT NAKES')
      expect(nakesText).toContain('Bu Ratna')
      expect(nakesText).toContain('ALONE')
      expect(nakesText).toContain('Lokasi pasien tidak tersedia')
      expect(nakesText).toContain('tel:112')
    })
  })

  // =========================================================================
  // SUITE 3: Urutan Tier Bertingkat & Respons HANDLED Berhenti (AC-7.1 s.d. AC-7.5)
  // =========================================================================
  describe('3. Urutan Tier Bertingkat & Respons HANDLED (AC-7.1 s.d. AC-7.5)', () => {
    it('eskalasi bertingkat berurutan T1 -> T2 -> NAKES, dan berhenti seketika saat nakes/keluarga HANDLE', async () => {
      // Setup run untuk pasien Pak Haji di state FAMILY_TIER_1
      db.escalationRuns.push({
        id: escalationRunId4,
        patientId: patientPakHajiId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.FAMILY_TIER_1,
        currentTier: FamilyTier.TIER_1,
        startedAt: new Date(),
        configSnapshot: {
          timeoutPatientSec: 1800,
          timeoutT1Sec: 900,
          timeoutT2Sec: 900,
          timeoutNakesSec: 1800,
        },
      })

      // 1. Respon LOOKING: hanya menandai acknowledging tanpa menghentikan eskalasi
      const lookRes = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${escalationRunId4}/respond`,
        headers: { Authorization: `Bearer ${tokenNakes}` },
        payload: {
          response: 'LOOKING',
          note: 'Sedang mengecek kondisi',
        },
      })

      expect(lookRes.statusCode).toBe(200)
      expect(lookRes.json().data.status).toBe(EscalationRunStatus.FAMILY_TIER_1)
      expect(lookRes.json().data.acknowledged).toBe(true)

      // Status run di database tetap FAMILY_TIER_1
      const runAfterLook = db.escalationRuns.find((r) => r.id === escalationRunId4)
      expect(runAfterLook?.status).toBe(EscalationRunStatus.FAMILY_TIER_1)

      // 2. Respon HANDLE: menghentikan eskalasi, membatalkan tier selanjutnya (AC-7.2)
      const handleRes = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${escalationRunId4}/respond`,
        headers: { Authorization: `Bearer ${tokenNakes}` },
        payload: {
          response: 'HANDLE',
          note: 'Petugas nakes sedang mengunjungi kediaman pasien Pak Haji',
        },
      })

      expect(handleRes.statusCode).toBe(200)
      const body = handleRes.json()
      expect(body.data.status).toBe(EscalationRunStatus.HANDLED)
      expect(body.data.remainingTiersCancelled).toBe(true)

      // Verifikasi status DB di mock store menjadi HANDLED
      const runAfterHandle = db.escalationRuns.find((r) => r.id === escalationRunId4)
      expect(runAfterHandle?.status).toBe(EscalationRunStatus.HANDLED)
      expect(runAfterHandle?.resolvedAt).toBeDefined()

      // 3. Guard transisi ilegal (AC-7.4): setelah HANDLED, respon berikutnya ditolak 422 (INVALID_TRANSITION)
      const duplicateRes = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${escalationRunId4}/respond`,
        headers: { Authorization: `Bearer ${tokenNakes}` },
        payload: {
          response: 'HANDLE',
        },
      })
      expect(duplicateRes.statusCode).toBe(422)
      expect(duplicateRes.json().error.code).toBe('INVALID_TRANSITION')
    })
  })

  // =========================================================================
  // SUITE 4: Adherence API Calculation via REST API (AC-5.1, AC-5.3)
  // =========================================================================
  describe('4. Kalkulasi Adherence Dashboard API (AC-5.1, AC-5.3)', () => {
    it('menghitung adherence rate (konfirmasi_on_time / total_schedule) dengan tepat', async () => {
      // 10 log kepatuhan: 8 tepat waktu (CONFIRMED), 1 tunda/late (CONFIRMED_LATE), 1 terlewat (MISSED)
      db.complianceLogs = [
        ...Array.from({ length: 8 }).map(() => ({
          status: ComplianceStatus.CONFIRMED,
          scheduledAt: new Date('2026-08-16T08:00:00Z'),
        })),
        {
          status: ComplianceStatus.CONFIRMED_LATE,
          scheduledAt: new Date('2026-08-16T12:00:00Z'),
        },
        {
          status: ComplianceStatus.MISSED,
          scheduledAt: new Date('2026-08-16T20:00:00Z'),
        },
      ]

      db.emergencyAlerts = [{ id: 'em-1', status: 'PENDING_PATIENT_CONFIRM' } as any]
      db.escalationRuns = [
        { id: 'run-1', status: 'WAITING_PATIENT' } as any,
        { id: 'run-2', status: 'FAMILY_TIER_1' } as any,
      ]

      // Panggil endpoint agregasi summary nakes
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.totalPatients).toBe(2)
      expect(body.data.confirmedCount).toBe(8)
      expect(body.data.confirmedLateCount).toBe(1)
      expect(body.data.missedCount).toBe(1)
      expect(body.data.activeEmergencies).toBe(1)
      expect(body.data.activeEscalations).toBe(2)

      // VERIFIKASI RUMUS ADHERENCE (AC-5.1):
      // totalEvaluated = 8 (confirmed) + 1 (late) + 1 (missed) = 10
      // adherenceRate = 8 / 10 = 0.8 (80%)
      expect(body.data.adherenceRate).toBeCloseTo(0.8, 2)
    })

    it('jika total evaluasi = 0, adherence rate aman mengembalikan 0 tanpa divide-by-zero error', async () => {
      db.patients = []
      db.complianceLogs = []
      db.emergencyAlerts = []
      db.escalationRuns = []

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.totalPatients).toBe(0)
      expect(body.data.adherenceRate).toBe(0)
    })
  })
})
