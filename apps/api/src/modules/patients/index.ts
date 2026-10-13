import type { FastifyInstance } from 'fastify'
import { PatientStatus, UserRole } from '@careloop/shared'
import { z } from 'zod'
import { patientLookupQuerySchema } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import {
  authenticate,
  getAuthUser,
  requireCareTeamRole,
  requireClinicalRole,
  requireRole,
} from '../../lib/auth'
import { auditContext } from '../../lib/audit'
import {
  assertPatientInScope,
  createPatient,
  getPatient,
  listOwnMedications,
  listPatients,
  setHrThresholds,
  updatePatient,
  type MedicationListPrismaClient,
  type PatientsPrismaClient,
} from './patients.service'
import {
  activatePatient,
  changePatientStatus,
  getPatientActivation,
  type ActivationPrismaClient,
} from './activation.service'
import {
  linkClinic,
  lookupExisting,
  sendVerificationInstructions,
  type OnboardingPrismaClient,
} from './onboarding.service'

export {
  assertPatientInScope,
  createPatient,
  getPatient,
  listPatients,
  setHrThresholds,
  updatePatient,
  activatePatient,
  changePatientStatus,
  getPatientActivation,
}
export type { ActivationPrismaClient } from './activation.service'
export type { LookupResult, LookupMatch } from './onboarding.service'
export type {
  ACTIVATION_REQUIREMENT_KEYS,
  ActivationCheck,
  ActivationChecklist,
  ActivationRequirementKey,
} from './activation'
export type {
  PatientsPrismaClient,
  PatientDetail,
  PatientSummary,
  ListPatientsResult,
  CreatePatientParams,
  UpdatePatientParams,
  SetHrThresholdsParams,
  AuditContext,
} from './patients.service'

// Tahap 1 & 2 alur (docs/API.md §3.1): nakes mengelola pasien di wilayahnya,
// admin bebas. Pasien sendiri tidak masuk lewat sini — profilnya memakai /v1/patients/me.
const CLINICAL_STAFF: UserRole[] = [UserRole.NAKES, UserRole.ADMIN]

export function registerPatientsRoutes(app: FastifyInstance): void {
  // POST /v1/patients — Nakes mendaftarkan pasien baru (Tahap 1: perawat/petugas faskes).
  app.post(
    '/v1/patients',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const patient = await createPatient(prisma as unknown as PatientsPrismaClient, {
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return reply.code(201).send({ data: patient })
    },
  )

  // GET /v1/patients — daftar pasien dalam scope nakes.
  app.get(
    '/v1/patients',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const result = await listPatients(prisma as unknown as PatientsPrismaClient, {
        claims,
        query: req.query as any,
      })
      return {
        data: result.items,
        meta: { total: result.total, pageSize: result.limit, page: result.offset / result.limit + 1 },
      }
    },
  )

  // GET /v1/patients/:id — detail pasien dalam scope.
  app.get<{ Params: { id: string } }>(
    '/v1/patients/:id',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await getPatient(
        prisma as unknown as PatientsPrismaClient,
        claims,
        req.params.id,
      )
      return { data }
    },
  )

  // PUT /v1/patients/:id — perbarui data dasar & riwayat penyakit.
  app.put<{ Params: { id: string } }>(
    '/v1/patients/:id',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await updatePatient(prisma as unknown as PatientsPrismaClient, {
        patientId: req.params.id,
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return { data }
    },
  )

  // GET /v1/patients/me/medications — obat yang sedang diminum pasien sendiri.
  // Dipakai form "Minta obat" di aplikasi pasien: pasien hanya boleh meminta
  // obat yang sudah ada resep aktifnya, bukan obat bebas (docs/API.md §3.6).
  // patientId selalu dari claim JWT, jadi tidak ada cara meminta obat milik orang lain.
  app.get(
    '/v1/patients/me/medications',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.FAMILY)] },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await listOwnMedications(
        prisma as unknown as MedicationListPrismaClient,
        claims,
      )
      return { data }
    },
  )

  // PUT /v1/patients/:id/hr-thresholds — penetapan ambang detak jantung.
  // Gerbang klinis: hanya DOKTER/BIDAN (atau ADMIN). Perawat hanya bisa melihatnya.
  app.put<{ Params: { id: string } }>(
    '/v1/patients/:id/hr-thresholds',
    {
      preHandler: [
        authenticate,
        requireCareTeamRole(),
        requireClinicalRole('DOKTER', 'BIDAN'),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await setHrThresholds(prisma as unknown as PatientsPrismaClient, {
        patientId: req.params.id,
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return { data }
    },
  )

  // GET /v1/patients/:id/activation — checklist prasyarat aktivasi.
  // Dapat dibaca siapa pun di tim medis (termasuk perawat) supaya bisa melengkapi
  // data, tapi hanya DOKTER/BIDAN/ADMIN yang boleh menjalankan POST activate.
  app.get<{ Params: { id: string } }>(
    '/v1/patients/:id/activation',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const checklist = await getPatientActivation(
        prisma as unknown as ActivationPrismaClient,
        claims,
        req.params.id,
      )
      return { data: checklist }
    },
  )

  // POST /v1/patients/:id/activate — satu-satunya jalan menuju status ACTIVE.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/activate',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const result = await activatePatient(prisma as unknown as ActivationPrismaClient, {
        patientId: req.params.id,
        to: PatientStatus.ACTIVE,
        claims,
        audit: auditContext(req),
      })
      return reply.code(200).send({ data: result })
    },
  )

  // PATCH /v1/patients/:id/status — penangguhan dan pemulihan.
  // Menuju ACTIVE ditolak di sini; harus lewat /activate supaya checklist diperiksa.
  app.patch<{ Params: { id: string } }>(
    '/v1/patients/:id/status',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const body = z
        .object({
          status: z.enum([
            PatientStatus.ONBOARDING,
            PatientStatus.INACTIVE,
            PatientStatus.BLOCKED,
          ]),
          reason: z.string().trim().min(3).max(280).optional(),
        })
        .parse(req.body ?? {})

      const claims = getAuthUser(req)
      const result = await changePatientStatus(prisma as unknown as ActivationPrismaClient, {
        patientId: req.params.id,
        to: body.status,
        reason: body.reason,
        claims,
        audit: auditContext(req),
      })
      return { data: result }
    },
  )
  // GET /v1/patients/lookup — cek duplikasi sebelum membuat pasien.
  // DichECK dulu di layar, karena satu akun ganda membuat pasien "hilang" dari
  // dashboard dan membingungkan seluruh tim.
  app.get<{ Querystring: { phone?: string; nik?: string } }>(
    '/v1/patients/lookup',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const input = patientLookupQuerySchema.parse(req.query ?? {})
      const data = await lookupExisting(prisma as unknown as OnboardingPrismaClient, {
        claims: getAuthUser(req),
        phone: input.phone,
        nik: input.nik,
      })
      return { data }
    },
  )

  // POST /v1/patients/:id/link-clinic — tautkan pasien yang sudah ada ke puskesmas.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/link-clinic',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const body = z.object({ clinicId: z.string().uuid() }).parse(req.body ?? {})
      const claims = getAuthUser(req)
      const data = await linkClinic(prisma as unknown as OnboardingPrismaClient, {
        patientId: req.params.id,
        clinicId: body.clinicId,
        claims,
        audit: auditContext(req),
      })
      return { data }
    },
  )

  // POST /v1/patients/:id/verification-instructions — kirim ulang instruksi OTP.
  // Tidak pernah menandai pasien sebagai terverifikasi; hanya /v1/auth/otp/verify
  // yang boleh melakukan itu.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/verification-instructions',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await sendVerificationInstructions(
        prisma as unknown as OnboardingPrismaClient,
        { patientId: req.params.id, claims, audit: auditContext(req) },
      )
      return { data }
    },
  )
}
