import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  UserRole,
  complianceConfirmSchema,
  complianceDeferSchema,
  complianceListQuerySchema,
} from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireCareTeamRole, requireRole } from '../../lib/auth'
import { notFound } from '../../lib/errors'
import { getReminderJobQueue } from '../reminders/reminder.queue'
import { assertPatientInScope, type PatientsPrismaClient } from '../patients/patients.service'
import {
  assertScheduleOwner,
  confirmMedicationIntake,
  deferMedicationIntake,
  listPatientCompliance,
  type CompliancePrismaClient,
} from './compliance.service'

export {
  assertScheduleOwner,
  classifyConfirmation,
  confirmMedicationIntake,
  deferMedicationIntake,
  isBeyondLatenessLimit,
  listPatientCompliance,
  resolveConfirmSlot,
} from './compliance.service'
export type {
  ClassificationInput,
  ComplianceListItem,
  ComplianceListResult,
  CompliancePrismaClient,
  ConfirmIntakeInput,
  ConfirmIntakeResult,
  ConfirmSchedule,
  ConfirmSlot,
  DeferExecutionDeps,
  DeferIntakeInput,
  DeferIntakeResult,
} from './compliance.service'

/**
 * Pemilik jadwal dibaca langsung karena `assertScheduleOwner` butuh patientId sebelum
 * service dipanggil, sedangkan service sendiri tidak boleh bergantung pada JWT.
 */
async function readScheduleOwner(
  req: FastifyRequest,
  scheduleId: string,
): Promise<{ claimsSub: string; claimsRole: string; patientId: string }> {
  const claims = getAuthUser(req)
  const schedule = await (prisma as unknown as CompliancePrismaClient).schedule.findUnique({
    where: { id: scheduleId },
    select: { patientId: true },
  })

  if (!schedule) throw notFound(`Jadwal ${scheduleId} tidak ditemukan`)

  return {
    claimsSub: claims.sub,
    claimsRole: claims.role,
    patientId: schedule.patientId,
  }
}

export function registerComplianceRoutes(app: FastifyInstance): void {
  // POST /v1/compliance/confirm — Konfirmasi "sudah minum" (docs/API.md §3.3 / CL-107).
  // Jalur WhatsApp tidak lewat sini: reply tombol ditangani webhook (CL-112) yang memanggil
  // `confirmMedicationIntake` agar idempotensi tetap satu sumber.
  app.post(
    '/v1/compliance/confirm',
    // Hanya pasien: konfirmasi adalah bukti pasien minum obat sendiri, jadi nakes/admin
    // tidak boleh mengatakannya behalf pasien (audit pun akan memalsukan actorRole).
    { preHandler: [authenticate, requireRole(UserRole.PATIENT)] },
    async (req, reply) => {
      const input = complianceConfirmSchema.parse(req.body ?? {})
      const owner = await readScheduleOwner(req, input.scheduleId)

      assertScheduleOwner({
        claimsRole: owner.claimsRole,
        claimsSub: owner.claimsSub,
        patientId: owner.patientId,
      })

      const result = await confirmMedicationIntake(prisma as unknown as CompliancePrismaClient, {
        scheduleId: input.scheduleId,
        channel: input.channel,
        actorUserId: owner.claimsSub,
      })

      return reply.code(200).send({
        data: {
          logId: result.log.id,
          scheduleId: input.scheduleId,
          scheduledAt: result.scheduledAt.toISOString(),
          status: result.status,
          confirmedAt: result.log.confirmedAt.toISOString(),
          escalationCancelled: result.escalationResolved,
          escalationRunId: result.escalationRunId,
        },
      })
    },
  )

  // POST /v1/compliance/defer — "Belum siap / tunda 15 menit" (FR-2.4 / AC-2.4).
  // Slot dicatat TUNDA dan pengingat dijadwalkan ulang; run eskalasi dibiarkan terbuka
  // karena menunda bukan berarti sudah minum.
  app.post(
    '/v1/compliance/defer',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT)] },
    async (req, reply) => {
      const input = complianceDeferSchema.parse(req.body ?? {})
      const owner = await readScheduleOwner(req, input.scheduleId)

      assertScheduleOwner({
        claimsRole: owner.claimsRole,
        claimsSub: owner.claimsSub,
        patientId: owner.patientId,
      })

      const result = await deferMedicationIntake(
        prisma as unknown as CompliancePrismaClient,
        {
          scheduleId: input.scheduleId,
          channel: 'WHATSAPP',
          minutes: input.minutes,
          actorUserId: owner.claimsSub,
        },
        {
          enqueueReminder: async ({ scheduleId, dueAt }) => {
            const queue = getReminderJobQueue()
            return queue.schedule(
              { scheduleId, dueAt: dueAt.toISOString() },
              Math.max(0, dueAt.getTime() - Date.now()),
              { jobId: `reminder-${scheduleId}-defer-${dueAt.getTime()}` },
            )
          },
        },
      )

      return reply.code(200).send({
        data: {
          logId: result.log.id,
          scheduleId: input.scheduleId,
          scheduledAt: result.scheduledAt.toISOString(),
          status: result.log.status,
          deferredUntil: result.deferredUntil.toISOString(),
          minutes: result.minutes,
          alreadyDeferred: result.alreadyDeferred,
          escalationRunId: result.escalationRunId,
        },
      })
    },
  )

  // GET /v1/patients/:id/compliance — timeline "sudah minum" versi nakes.
  // Konfirmasi pasien (WhatsApp atau tombol app) terkumpul di sini, sehingga
  // perawat & dokter bisa melihat kepatuhan per pasien, bukan cuma agregat.
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/v1/patients/:id/compliance',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const query = complianceListQuerySchema.parse(req.query ?? {})

      await assertPatientInScope(prisma as unknown as PatientsPrismaClient, claims, req.params.id)

      const result = await listPatientCompliance(prisma as unknown as CompliancePrismaClient, {
        patientId: req.params.id,
        from: query.from,
        to: query.to,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      })

      return {
        data: result.items,
        meta: {
          total: result.total,
          pageSize: result.limit,
          page: Math.floor(result.offset / result.limit) + 1,
          summary: result.summary,
        },
      }
    },
  )
}
