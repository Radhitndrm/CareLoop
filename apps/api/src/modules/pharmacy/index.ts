// Routes alur farmasi (docs/API.md §3.6).
//
// Gerbang kewenangan (AGENTS.md §2):
// - POST /v1/medication-requests            → hanya PASIEN/KELUARGA (untuk dirinya sendiri)
// - PATCH /v1/medication-requests/:id/decision → hanya DOKTER/BIDAN
// - PATCH /v1/medication-requests/:id/status   → hanya FARMASI
// - PATCH /v1/medications/:id                   → hanya DOKTER/BIDAN (penyesuaian resep)
//
// Apotek dan dokter punya kewenangan yang SANGAT BERBEDA dan tidak boleh
// saling menggantikan: dokter menyetujui, apotek menyiapkan.
import type { FastifyInstance } from 'fastify'
import { NakesRole, UserRole } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireClinicalRole, requirePharmacyRole, requireRole } from '../../lib/auth'
import { auditContext } from '../../lib/audit'
import {
  changeMedicationRequestStatus,
  createMedicationRequest,
  decideMedicationRequest,
  generateRoutineRequests,
  getMedicationRequest,
listDispensingRecords,
  listMedicationRequests,
  resolveSubstitution,
  type PharmacyPrismaClient,
} from './pharmacy.service'
import { medicationSubstitutionSchema } from '@careloop/shared'

export {
  changeMedicationRequestStatus,
  createMedicationRequest,
  decideMedicationRequest,
  generateRoutineRequests,
  getMedicationRequest,
  listDispensingRecords,
  listMedicationRequests,
  resolveSubstitution,
}
export type { PharmacyPrismaClient, MedicationRequestOutput } from './pharmacy.service'

const PATIENTS: UserRole[] = [UserRole.PATIENT, UserRole.FAMILY]
const PHARMACY_STAFF: UserRole[] = [UserRole.NAKES, UserRole.ADMIN]
const PRESCRIBERS: NakesRole[] = [NakesRole.DOKTER, NakesRole.BIDAN]
const PHARMACISTS: NakesRole[] = [NakesRole.FARMASI]

function db(): PharmacyPrismaClient {
  return prisma as unknown as PharmacyPrismaClient
}

export function registerPharmacyRoutes(app: FastifyInstance): void {
  // POST /v1/medication-requests — pasien mengajukan permintaan di luar jadwal.
  // patientId diambil dari claim JWT; body tidak pernah menyertakannya.
  app.post(
    '/v1/medication-requests',
    { preHandler: [authenticate, requireRole(...PATIENTS)] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const data = await createMedicationRequest(
        db(),
        {
          input: req.body as any,
          claims,
          audit: auditContext(req),
        },
        req.log,
      )
      return reply.code(201).send({ data })
    },
  )

  // GET /v1/medication-requests — antrean farmasi & daftar menunggu dokter.
  // Role PASIEN/FAMILY seeing melihat hanya miliknya sendiri (di-pin server).
  app.get(
    '/v1/medication-requests',
    {
      preHandler: [
        authenticate,
        requireRole(UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const result = await listMedicationRequests(db(), {
        query: req.query as any,
        claims,
      })
      return {
        data: result.items,
        meta: {
          total: result.total,
          page: 1,
          pageSize: result.items.length,
          summary: result.summary,
        },
      }
    },
  )

  // GET /v1/medication-requests/queue-summary — badge count di navbar farmasi.
  app.get(
    '/v1/medication-requests/queue-summary',
    { preHandler: [authenticate, requireRole(...PHARMACY_STAFF)] },
    async (req) => {
      const claims = getAuthUser(req)
      const result = await listMedicationRequests(db(), {
        query: { limit: 1, offset: 0 } as any,
        claims,
      })
      return { data: result.summary }
    },
  )

  // POST /v1/medication-requests/generate-routine — scheduler harian & trigger demo.
  app.post(
    '/v1/medication-requests/generate-routine',
    { preHandler: [authenticate, requireRole(...PHARMACY_STAFF)] },
    async (req) => {
      const result = await generateRoutineRequests(db(), { logger: req.log })
      return { data: result }
    },
  )

  // GET /v1/medication-requests/:id — detail + audit trail.
  app.get<{ Params: { id: string } }>(
    '/v1/medication-requests/:id',
    {
      preHandler: [
        authenticate,
        requireRole(UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await getMedicationRequest(db(), { requestId: req.params.id, claims })
      return { data }
    },
  )

  // PATCH /v1/medication-requests/:id/decision — dokter menyetujui / menolak.
  // requireClinicalRole ensures PERAWAT/KADER/FARMASI tidak bisa masuk ke sini.
  app.patch<{ Params: { id: string } }>(
    '/v1/medication-requests/:id/decision',
    {
      preHandler: [
        authenticate,
        requireRole(...PHARMACY_STAFF),
        requireClinicalRole(...PRESCRIBERS),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await decideMedicationRequest(
        db(),
        {
          requestId: req.params.id,
          input: req.body as any,
          claims,
          audit: auditContext(req),
        },
        req.log,
      )
      return { data }
    },
  )

  // PATCH /v1/medication-requests/:id/status — seluruh aksi farmasi.
  // requirePharmacyRole: apotek menyiapkan & menyerahkan, dokter tidak.
  app.patch<{ Params: { id: string } }>(
    '/v1/medication-requests/:id/status',
    {
      preHandler: [
        authenticate,
        requireRole(...PHARMACY_STAFF),
        requirePharmacyRole(...PHARMACISTS),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await changeMedicationRequestStatus(
        db(),
        {
          requestId: req.params.id,
          input: req.body as any,
          claims,
          audit: auditContext(req),
        },
        req.log,
      )
      return { data }
    },
  )

  // GET /v1/dispensing-records — riwayat penyerahan.
  app.get(
    '/v1/dispensing-records',
    {
      preHandler: [
        authenticate,
        requireRole(UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const result = await listDispensingRecords(db(), {
        query: req.query as any,
        claims,
      })
      return {
        data: result.items,
        meta: { total: result.total, page: 1, pageSize: result.items.length },
      }
    },
  )

  // PATCH /v1/medications/:id — dokter menyetujui penggantian obat yang ditandai
  // apotek. Satu-satunya jalan keluar dari SUBSTITUTED (docs/API.md §3.6).
  app.patch<{ Params: { id: string } }>(
    '/v1/medications/:id',
    {
      preHandler: [
        authenticate,
        requireRole(...PHARMACY_STAFF),
        requireClinicalRole(...PRESCRIBERS),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const input = medicationSubstitutionSchema.parse(req.body)
      const data = await resolveSubstitution(
        db(),
        {
          medicationId: req.params.id,
          substituteApproved: input.substituteApproved,
          instruction: input.instruction,
          claims,
          audit: auditContext(req),
        },
        req.log,
      )
      return { data }
    },
  )
}