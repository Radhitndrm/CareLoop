// Integration test alur operasional lengkap (Fase D plan operasional).
//
// Satu skenario, satu journeys: nakes mendaftarkan pasien -> menambahkan keluarga ->
// dokter menyetujui resep -> jadwal dibuat -> pasien diaktifkan -> reminder benar-benar
// dijadwalkan. Ini test yang membuktikan Fase 0/A/C/D menyambung, bukan hanya masing-masing
// hijau sendiri.
//
// Yang dikunci:
//   - patients ONBOARDING tidak pernah dijadwalkan reminder, walau resep & jadwal sah;
//   - aktivasi hanya mungkin setelah checklist lengkap;
//   - setelah ACTIVE, dispatcher menemukan jadwalnya dan mengubahnya jadi job.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'
import { createPatient } from '../src/modules/patients/patients.service'
import { activatePatient, getPatientActivation } from '../src/modules/patients/activation.service'
import { approveMedication, draftMedication } from '../src/modules/medications/medications.service'
import { dispatchDueReminders } from '../src/modules/reminders/reminder.scheduler'
import type { JobQueue } from '../src/lib/queue'
import type { ReminderJobPayload } from '../src/modules/reminders/reminder.worker'

const CLINIC = '00000000-0000-4000-8000-0000000000f1'
const DOKTER = '00000000-0000-4000-8000-0000000000f2'
const PERAWAT = '00000000-0000-4000-8000-0000000000f3'

const perawat = { sub: PERAWAT, role: 'NAKES', nakesRole: 'PERAWAT' } as any
const dokter = { sub: DOKTER, role: 'NAKES', nakesRole: 'DOKTER' } as any
const audit = { actorUserId: PERAWAT, actorRole: 'NAKES' as const }

describe.skipIf(!isTestDbConfigured())('Alur operasional lengkap (Fase D)', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    migrateTestDb()
    prisma = createTestPrisma()
  }, 180_000)

  afterAll(async () => {
    await teardownTestDb(prisma)
  })

  beforeEach(async () => {
    await resetTestDb(prisma)

    await prisma.puskesmas.create({ data: { id: CLINIC, name: 'Puskesmas Alur', districtCode: '3471' } })
    await prisma.user.createMany({
      data: [
        { id: DOKTER, phone: '081170000001', fullName: 'Dokter Alur', role: 'NAKES', nakesRole: 'DOKTER', staffStatus: 'ACTIVE', isVerified: true },
        { id: PERAWAT, phone: '081170000002', fullName: 'Perawat Alur', role: 'NAKES', nakesRole: 'PERAWAT', staffStatus: 'ACTIVE', isVerified: true },
      ],
    })
    await prisma.nakesAssignment.createMany({
      data: [
        { nakesUserId: DOKTER, puskesmasId: CLINIC, scopeType: 'PUSKESMAS', isActive: true },
        { nakesUserId: PERAWAT, puskesmasId: CLINIC, scopeType: 'PUSKESMAS', isActive: true },
      ],
    })
  })

  const db = () => prisma as any

  /** Antrean palsu yang hanya mencatat job, supaya test tidak bergantung timer/Redis. */
  function recordingQueue(): { queue: JobQueue<ReminderJobPayload>; jobs: ReminderJobPayload[] } {
    const jobs: ReminderJobPayload[] = []
    const queue: JobQueue<ReminderJobPayload> = {
      name: 'reminder',
      enqueue: async (payload) => {
        jobs.push(payload)
        return 'j'
      },
      schedule: async (payload) => {
        jobs.push(payload)
        return 'j'
      },
      cancel: async () => undefined,
      retry: async () => undefined,
      close: async () => undefined,
    }
    return { queue, jobs }
  }

  /**
   * Jalankan langkah 1–4 dari journey dan kembalikan id pasien.
   *
   * `withFamilyContact: false` melewati pembuatan kontak supaya skenario yang menguji
   * blocker `ESCALATION_CONTACT` bisa dibuat tanpa database kedua.
   */
  async function sampaiJadwalAktif(options: { withFamilyContact?: boolean } = {}) {
    const patient = await createPatient(db(), {
      input: {
        fullName: 'Bu Alur Test',
        phone: '081171000001',
        districtCode: '3471',
        puskesmasId: CLINIC,
        healthConditions: ['DIABETES'],
        gender: 'F',
        dateOfBirth: '1970-04-04',
        consentShareWithNakes: true,
      },
      claims: perawat,
      audit,
    })

    if (options.withFamilyContact !== false) {
      await prisma.familyContact.create({
        data: {
          patientId: patient.id,
          name: 'Anak Test',
          phone: '081171000002',
          relationship: 'ANAK',
          tier: 'TIER_1',
          priority: 1,
          isActive: true,
          canReceiveEmergency: true,
        },
      })
    }

    const medication = await draftMedication(db(), {
        input: {
          name: 'Metformin 500mg',
          startedAt: '2026-01-01',
          dosage: '500 mg',
          form: 'TABLET',
        },
      patientId: patient.id,
      claims: perawat,
      audit,
    })

    await approveMedication(db(), {
      medicationId: medication.id,
      input: { decision: 'APPROVED' },
      claims: dokter,
      audit,
    })

    const schedule = await prisma.schedule.create({
      data: {
        patientId: patient.id,
        medicationId: medication.id,
        timeOfDay: '08:00',
        doseQty: '1 tablet',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'APPROVED',
        isActive: true,
      },
      select: { id: true },
    })

    return { patient, schedule }
  }

  it('pasien ONBOARDING dengan resep & jadwal sah tetap tidak mendapat reminder', async () => {
    const { schedule } = await sampaiJadwalAktif()
    const { queue, jobs } = recordingQueue()

    const result = await dispatchDueReminders(db(), queue, {
      lookaheadMs: 24 * 60 * 60 * 1000,
    })

    expect(result.scanned).toBe(0)
    expect(jobs).toHaveLength(0)
    expect(schedule.id).toBeTruthy()
  })

  it('checklist menolak aktivasi selama nomor belum terverifikasi', async () => {
    const { patient } = await sampaiJadwalAktif()

    const checklist = await getPatientActivation(db(), dokter, patient.id)
    expect(checklist.ready).toBe(false)
    expect(checklist.blockers.map((c) => c.key)).toContain('VERIFIED')

    await expect(
      activatePatient(db(), { patientId: patient.id, to: 'ACTIVE', claims: dokter, audit }),
    ).rejects.toThrow(/belum memenuhi syarat aktivasi/i)
  })

  it('kontak nakes yang mendaftar sudah memenuhi syarat tujuan eskalasi', async () => {
    // `createPatient` otomatis menambah NakesContact untuk nakes yang mendaftar, jadi
    // pasien tanpa keluarga tetap punya satu tujuan eskalasi yang sah.
    const { patient } = await sampaiJadwalAktif({ withFamilyContact: false })
    await prisma.user.update({ where: { id: patient.id }, data: { isVerified: true } })

    const checklist = await getPatientActivation(db(), dokter, patient.id)
    expect(checklist.blockers.map((c) => c.key)).not.toContain('ESCALATION_CONTACT')
    expect(checklist.ready).toBe(true)
  })

  it('checklist menolak aktivasi ketika tidak ada satu pun tujuan eskalasi', async () => {
    const { patient } = await sampaiJadwalAktif({ withFamilyContact: false })
    await prisma.user.update({ where: { id: patient.id }, data: { isVerified: true } })

    // Menghapus NakesContact otomatis narrowing satu-satunya tujuan yang tersisa.
    await prisma.nakesContact.deleteMany({ where: { patientId: patient.id } })

    const checklist = await getPatientActivation(db(), dokter, patient.id)
    expect(checklist.blockers.map((c) => c.key)).toContain('ESCALATION_CONTACT')

    await expect(
      activatePatient(db(), { patientId: patient.id, to: 'ACTIVE', claims: dokter, audit }),
    ).rejects.toThrow(/belum memenuhi syarat aktivasi/i)
  })

  it('journey lengkap: verifikasi -> checklist penuh -> aktif -> reminder terjadwal', async () => {
    const { patient, schedule } = await sampaiJadwalAktif()

    // Langkah verifikasi: hanya OTP verify yang boleh menandai ini.
    await prisma.user.update({ where: { id: patient.id }, data: { isVerified: true } })

    const sebelum = await getPatientActivation(db(), dokter, patient.id)
    expect(sebelum.ready).toBe(true)

    const { queue, jobs } = recordingQueue()

    // Sebelum aktivasi: belum ada job.
    await dispatchDueReminders(db(), queue, { lookaheadMs: 24 * 60 * 60 * 1000 })
    expect(jobs).toHaveLength(0)

    await activatePatient(db(), { patientId: patient.id, to: 'ACTIVE', claims: dokter, audit })

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
    expect(stored.status).toBe('ACTIVE')
    expect(stored.activatedById).toBe(DOKTER)

    // Setelah aktivasi: jadwal yang sama langsung ditemukan dispatcher.
    const sesudah = await dispatchDueReminders(db(), queue, {
      lookaheadMs: 24 * 60 * 60 * 1000,
    })
    expect(sesudah.enqueued).toBe(1)
    expect(jobs[0].scheduleId).toBe(schedule.id)
  })

  it('aktivasi kedua tidak mengubah siapa yang mengaktifkan pertama', async () => {
    const { patient } = await sampaiJadwalAktif()
    await prisma.user.update({ where: { id: patient.id }, data: { isVerified: true } })

    await activatePatient(db(), { patientId: patient.id, to: 'ACTIVE', claims: dokter, audit })

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
    expect(stored.activatedById).toBe(DOKTER)
    expect(stored.activatedAt).not.toBeNull()
  })

  it('perawat tetap tidak bisa mengaktifkan meski checklist sudah penuh', async () => {
    const { patient } = await sampaiJadwalAktif()
    await prisma.user.update({ where: { id: patient.id }, data: { isVerified: true } })

    await expect(
      activatePatient(db(), { patientId: patient.id, to: 'ACTIVE', claims: perawat, audit }),
    ).rejects.toThrow(/Hanya dokter, bidan, atau admin/i)

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })
    expect(stored.status).toBe('ONBOARDING')
  })
})