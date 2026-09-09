// CL-208: Kanal Real-Time (WebSocket / Socket.IO) Dashboard Nakes.
// Mengirim event emergency prioritas ke dashboard nakes, terautentikasi (JWT)
// dan ter-scope per puskesmas/wilayah (docs/API.md §4, ADR-004, AC-4.5 support).
import type { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { createVerifier } from 'fast-jwt'
import type { AuthUserClaims } from '@careloop/shared'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'

export interface PriorityEmergencyEventData {
  emergencyId: string
  triggeredAt: string
  triggerType: string
  hrBpm?: number | null
  patient: {
    id: string
    fullName: string
    livingSituation?: string | null
  }
  location?: {
    lat: number
    lng: number
    accuracyM?: number
  } | null
  escalationRunId?: string | null
  tier?: string | null
  actionUrl?: string
  puskesmasId?: string | null
  districtCode?: string | null
}

export interface PriorityEmergencyEvent {
  event: 'emergency.priority'
  data: PriorityEmergencyEventData
}

export interface NakesAssignmentScope {
  puskesmasId?: string | null
  districtCode?: string | null
}

export interface DashboardWsOptions {
  jwtSecret?: string
  corsOrigin?: string | string[] | boolean
  prismaClient?: any
  findNakesAssignments?(userId: string): Promise<NakesAssignmentScope[]>
  verifyToken?(token: string): Promise<AuthUserClaims> | AuthUserClaims
}

let globalDashboardWsServer: SocketIOServer | null = null

export function getDashboardWsServer(): SocketIOServer | null {
  return globalDashboardWsServer
}

export function setDashboardWsServer(io: SocketIOServer | null): void {
  globalDashboardWsServer = io
}

/**
 * Membuat dan mengonfigurasi instance WebSocket Server (Socket.IO)
 * dengan autentikasi JWT dan room scoping berbasis puskesmas/wilayah (docs/API.md §4).
 */
export function createDashboardWsServer(
  server: HttpServer,
  options?: DashboardWsOptions,
): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: options?.corsOrigin ?? '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    serveClient: false,
  })

  // Middleware Autentikasi Handshake & Pengecekan Role (docs/API.md §4.1)
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.headers.authorization
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined) ??
        (socket.handshake.query?.token as string | undefined)

      if (!token) {
        return next(new Error('UNAUTHORIZED: Token authentication is required'))
      }

      let claims: AuthUserClaims
      if (options?.verifyToken) {
        claims = await options.verifyToken(token)
      } else {
        let secret: string
        try {
          secret = options?.jwtSecret ?? getEnv().JWT_SECRET
        } catch {
          secret = process.env.JWT_SECRET ?? 'fallback-secret-minimal-32-characters'
        }
        const verify = createVerifier({ key: secret })
        claims = verify(token) as AuthUserClaims
      }

      if (!claims || !claims.sub) {
        return next(new Error('UNAUTHORIZED: Invalid token claims'))
      }

      // Hanya NAKES dan ADMIN yang diizinkan mengakses kanal WebSocket dashboard
      if (claims.role !== 'NAKES' && claims.role !== 'ADMIN') {
        return next(new Error('FORBIDDEN: Only NAKES or ADMIN can access dashboard WebSocket'))
      }

      // Ambil penugasan puskesmas dan wilayah nakes
      let assignments: NakesAssignmentScope[] = []
      if (claims.role !== 'ADMIN') {
        if (options?.findNakesAssignments) {
          assignments = await options.findNakesAssignments(claims.sub)
        } else {
          const client = options?.prismaClient ?? prisma
          if (client.nakesAssignment?.findMany) {
            assignments = await client.nakesAssignment.findMany({
              where: { nakesUserId: claims.sub, isActive: true },
              select: { puskesmasId: true, districtCode: true },
            })
          }
        }
      }

      const puskesmasIds = assignments
        .map((a) => a.puskesmasId)
        .filter((id): id is string => Boolean(id))

      const districtCodes = assignments
        .map((a) => a.districtCode)
        .filter((code): code is string => Boolean(code))

      socket.data.user = claims
      socket.data.puskesmasIds = puskesmasIds
      socket.data.districtCodes = districtCodes

      next()
    } catch (err) {
      return next(
        new Error(
          'UNAUTHORIZED: ' + (err instanceof Error ? err.message : 'Failed to verify token'),
        ),
      )
    }
  })

  // Manajemen Koneksi & Room Scope (docs/API.md §4.2 & §4.3)
  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUserClaims
    const puskesmasIds = (socket.data.puskesmasIds as string[]) ?? []
    const districtCodes = (socket.data.districtCodes as string[]) ?? []

    // 1. Masuk ke personal room nakes: nakes:{nakesUserId}
    socket.join(`nakes:${user.sub}`)

    // 2. Masuk ke room puskesmas penugasan: puskesmas:{puskesmasId}
    for (const pId of puskesmasIds) {
      socket.join(`puskesmas:${pId}`)
    }

    // 3. Masuk ke room wilayah/district: district:{districtCode}
    for (const dCode of districtCodes) {
      socket.join(`district:${dCode}`)
    }

    // 4. Jika ADMIN, masuk ke room admin
    if (user.role === 'ADMIN') {
      socket.join('admin')
    }

    // Event client -> server: subscribe.scope (docs/API.md §4.3)
    socket.on(
      'subscribe.scope',
      ({ scope, id }: { scope: string; id: string }, callback?: (res: any) => void) => {
        const isAllowed =
          user.role === 'ADMIN' ||
          (scope === 'puskesmas' && puskesmasIds.includes(id)) ||
          (scope === 'district' && districtCodes.includes(id))

        if (isAllowed) {
          socket.join(`${scope}:${id}`)
          if (callback) {
            callback({ status: 'ok', scope, id })
          }
        } else {
          if (callback) {
            callback({
              status: 'error',
              code: 'FORBIDDEN',
              message: 'Tidak memiliki hak akses ke scope ini',
            })
          }
        }
      },
    )

    // Event client -> server: emergency.ack (docs/API.md §4.3)
    socket.on(
      'emergency.ack',
      ({ emergencyId }: { emergencyId: string }, callback?: (res: any) => void) => {
        if (callback) {
          callback({
            status: 'ok',
            emergencyId,
            ackByUserId: user.sub,
            ackAt: new Date().toISOString(),
          })
        }
      },
    )
  })

  setDashboardWsServer(io)
  return io
}

/**
 * Mengirim event emergency prioritas ke subscribers yang ter-scope (docs/API.md §4.4).
 * Hanya nakes pada puskesmas/wilayah terkait yang menerima siaran ini.
 */
export function emitPriorityEmergency(
  io: SocketIOServer,
  data: PriorityEmergencyEventData,
): { emittedPuskesmas: boolean; emittedDistrict: boolean; emittedAdmin: boolean } {
  const payload: PriorityEmergencyEvent = {
    event: 'emergency.priority',
    data,
  }

  const rooms: string[] = ['admin']
  let emittedPuskesmas = false
  let emittedDistrict = false

  if (data.puskesmasId) {
    rooms.push(`puskesmas:${data.puskesmasId}`)
    emittedPuskesmas = true
  }

  if (data.districtCode) {
    rooms.push(`district:${data.districtCode}`)
    emittedDistrict = true
  }

  io.to(rooms).emit('emergency.priority', payload)

  return {
    emittedPuskesmas,
    emittedDistrict,
    emittedAdmin: true,
  }
}

export interface EscalationStepEventData {
  runId: string
  tier: string
  status: string
  contactSummary?: string | null
  puskesmasId?: string | null
  districtCode?: string | null
}

export interface RiskUpdatedEventData {
  patientId: string
  riskLevel: string
  score: number
  puskesmasId?: string | null
  districtCode?: string | null
}

export interface ComplianceUpdatedEventData {
  patientId: string
  scheduleId: string
  status: string
  updatedAt?: string
}

/**
 * Mengirim event step eskalasi ke subscribers yang ter-scope (docs/API.md §4.3).
 */
export function emitEscalationStep(
  io: SocketIOServer,
  data: EscalationStepEventData,
): { emittedPuskesmas: boolean; emittedDistrict: boolean; emittedAdmin: boolean } {
  const payload = {
    event: 'escalation.step',
    data,
  }

  const rooms: string[] = ['admin']
  let emittedPuskesmas = false
  let emittedDistrict = false

  if (data.puskesmasId) {
    rooms.push(`puskesmas:${data.puskesmasId}`)
    emittedPuskesmas = true
  }

  if (data.districtCode) {
    rooms.push(`district:${data.districtCode}`)
    emittedDistrict = true
  }

  io.to(rooms).emit('escalation.step', payload)

  return {
    emittedPuskesmas,
    emittedDistrict,
    emittedAdmin: true,
  }
}

/**
 * Mengirim event update risiko pasien ke subscribers nakes (docs/API.md §4.3).
 */
export function emitRiskUpdated(
  io: SocketIOServer,
  data: RiskUpdatedEventData,
): { emittedPuskesmas: boolean; emittedDistrict: boolean; emittedAdmin: boolean } {
  const payload = {
    event: 'risk.updated',
    data,
  }

  const rooms: string[] = ['admin']
  let emittedPuskesmas = false
  let emittedDistrict = false

  if (data.puskesmasId) {
    rooms.push(`puskesmas:${data.puskesmasId}`)
    emittedPuskesmas = true
  }

  if (data.districtCode) {
    rooms.push(`district:${data.districtCode}`)
    emittedDistrict = true
  }

  io.to(rooms).emit('risk.updated', payload)

  return {
    emittedPuskesmas,
    emittedDistrict,
    emittedAdmin: true,
  }
}

/**
 * Mengirim event update kepatuhan ke subscriber (docs/API.md §4.3).
 */
export function emitComplianceUpdated(
  io: SocketIOServer,
  data: ComplianceUpdatedEventData,
): void {
  const payload = {
    event: 'compliance.updated',
    data,
  }
  io.to(`patient:${data.patientId}`).emit('compliance.updated', payload)
}

