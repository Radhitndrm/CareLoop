import type { FastifyInstance, FastifyRequest } from 'fastify'
import { UserRole, complianceConfirmSchema } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import { notFound } from '../../lib/errors'
import {
  assertScheduleOwner,
  confirmMedicationIntake,
  type CompliancePrismaClient,
} from './compliance.service'

export {
  assertScheduleOwner,
  classifyConfirmation,
  confirmMedicationIntake,
  isBeyondLatenessLimit,
  resolveConfirmSlot,
} from './compliance.service'
export type {
  ClassificationInput,
  CompliancePrismaClient,
  ConfirmIntakeInput,
  ConfirmIntakeResult,
  ConfirmSchedule,
  ConfirmSlot,
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
}
