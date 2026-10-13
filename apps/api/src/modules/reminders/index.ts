// Jadwal minum obat milik pasien sendiri (dipakai aplikasi pasien).
//
// Ini bukan daftar pengingat yang sudah dikirim — itu milik riwayat. Ini daftar
// **jadwal yang harus dikonfirmasi pasien**, beserta waktu berikutnya. Tanpa endpoint
// ini, aplikasi pasien tidak punya sumber data yang bukan dummy, dan seluruh alur
// konfirmasi 1-tap tidak bisa dipakai.
//
// Query difilter `status = 'APPROVED'` (gate klinis) dan hanya untuk akun pasien
// sendiri lewat `claims.sub` — `patientId` tidak pernah diterima dari body atau query,
// jadi pasien tidak bisa membaca atau mengonfirmasi jadwal orang lain.
import type { FastifyInstance } from 'fastify'
import { MedicationStatus, UserRole } from '@careloop/shared'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import { prisma } from '../../lib/prisma'
import { nextFireAt } from './next-fire-at'

export type OwnSchedulesClient = {
  schedule: {
    findMany(args: any): Promise<any[]>
  }
}

interface OwnSchedule {
  id: string
  medicationName: string
  dosage: string | null
  instructions: string | null
  doseQty: string
  timeOfDay: string
  daysOfWeek: number[]
  startDate: string | null
  endDate: string | null
  nextFireAt: string | null
}

/**
 * Client dioper agar unit/integration test bisa memakai koneksi DB-nya sendiri —
 * memakai Prisma global membuat test diam-diam menguji database dev.
 */
export async function listOwnSchedules(
  client: OwnSchedulesClient,
  patientUserId: string,
): Promise<OwnSchedule[]> {
  const schedules = await client.schedule.findMany({
    where: {
      patientId: patientUserId,
      isActive: true,
      status: MedicationStatus.APPROVED,
      medication: { status: MedicationStatus.APPROVED, isActive: true },
    },
    select: {
      id: true,
      timeOfDay: true,
      daysOfWeek: true,
      startDate: true,
      endDate: true,
      doseQty: true,
      medication: {
        select: { name: true, dosage: true, instructions: true },
      },
      patient: { select: { user: { select: { timezone: true } } } },
    },
    orderBy: { timeOfDay: 'asc' },
  })

  return schedules.map((schedule) => ({
    id: schedule.id,
    medicationName: schedule.medication.name,
    dosage: schedule.medication.dosage,
    instructions: schedule.medication.instructions,
    doseQty: schedule.doseQty,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    startDate: schedule.startDate ? schedule.startDate.toISOString().slice(0, 10) : null,
    endDate: schedule.endDate ? schedule.endDate.toISOString().slice(0, 10) : null,
    nextFireAt: formatNextFire(schedule),
  }))
}

function formatNextFire(schedule: {
  timeOfDay: string
  daysOfWeek: number[]
  startDate: Date | null
  endDate: Date | null
  patient: { user: { timezone: string } }
}): string | null {
  const fire = nextFireAt({
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    timezone: schedule.patient.user.timezone,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
  })
  return fire ? fire.toISOString() : null
}

export function registerRemindersRoutes(app: FastifyInstance): void {
  // Jadwal minum milik pasien sendiri.
  app.get(
    '/v1/patients/me/reminders',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.FAMILY)] },
    async (req) => {
      // claims.sub adalah User.id, yang juga Patient.id (relasi 1:1).
      const data = await listOwnSchedules(prisma, getAuthUser(req).sub)
      return { data }
    },
  )
}