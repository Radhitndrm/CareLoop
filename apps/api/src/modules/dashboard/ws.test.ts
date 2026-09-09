// CL-208: Test suite untuk Kanal Real-Time (WebSocket) Dashboard Nakes.
// Menguji autentikasi JWT handshake, otorisasi peran (NAKES/ADMIN),
// room scoping puskesmas/wilayah, isolasi event emergency prioritas,
// client event subscribe.scope & emergency.ack, serta lifecycle Fastify (docs/API.md §4).
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { createSigner } from 'fast-jwt'
import type { Server as SocketIOServer } from 'socket.io'
import {
  createDashboardWsServer,
  emitPriorityEmergency,
  emitEscalationStep,
  emitRiskUpdated,
  emitComplianceUpdated,
  getDashboardWsServer,
  setDashboardWsServer,
  type PriorityEmergencyEventData,
  type NakesAssignmentScope,
} from './ws'

const TEST_SECRET = 'test-secret-dashboard-ws-minimal-32-chars-long'
const signToken = createSigner({ key: TEST_SECRET })

describe('CL-208: Real-Time WebSocket Dashboard (Socket.IO)', () => {
  let httpServer: HttpServer
  let serverPort: number
  let ioServer: SocketIOServer

  // Mock data penugasan nakes:
  // nakes-1: Puskesmas P1, District D1
  // nakes-2: Puskesmas P2, District D2
  // nakes-3: Puskesmas P1, District D1
  const mockAssignments: Record<string, NakesAssignmentScope[]> = {
    'nakes-1': [{ puskesmasId: 'P1', districtCode: 'D1' }],
    'nakes-2': [{ puskesmasId: 'P2', districtCode: 'D2' }],
    'nakes-3': [{ puskesmasId: 'P1', districtCode: 'D1' }],
  }

  beforeAll(async () => {
    httpServer = createServer()
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo
        serverPort = addr.port
        resolve()
      })
    })

    ioServer = createDashboardWsServer(httpServer, {
      jwtSecret: TEST_SECRET,
      findNakesAssignments: async (userId: string) => {
        return mockAssignments[userId] ?? []
      },
    })
  })

  afterAll(async () => {
    if (ioServer) {
      await new Promise<void>((resolve) => ioServer.close(() => resolve()))
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
    setDashboardWsServer(null)
  })

  function connectClient(token?: string, authMethod: 'auth' | 'header' | 'query' = 'auth'): Promise<ClientSocket> {
    const url = `http://localhost:${serverPort}`
    const options: Parameters<typeof ioClient>[1] = {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    }

    if (token) {
      if (authMethod === 'auth') {
        options.auth = { token }
      } else if (authMethod === 'header') {
        options.extraHeaders = { Authorization: `Bearer ${token}` }
      } else if (authMethod === 'query') {
        options.query = { token }
      }
    }

    const socket = ioClient(url, options)

    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket))
      socket.once('connect_error', (err) => {
        socket.disconnect()
        reject(err)
      })
      socket.connect()
    })
  }

  describe('Autentikasi & Autorisasi Handshake (docs/API.md §4.1)', () => {
    it('menolak koneksi tanpa token dengan UNAUTHORIZED', async () => {
      await expect(connectClient()).rejects.toThrow(/UNAUTHORIZED/)
    })

    it('menolak koneksi dengan token rusak / invalid', async () => {
      await expect(connectClient('token-acak-salah')).rejects.toThrow(/UNAUTHORIZED/)
    })

    it('menolak koneksi jika role bukan NAKES atau ADMIN (misal PATIENT)', async () => {
      const patientToken = signToken({ sub: 'patient-1', role: 'PATIENT' })
      await expect(connectClient(patientToken)).rejects.toThrow(/FORBIDDEN.*NAKES or ADMIN/)
    })

    it('menerima koneksi NAKES dengan auth token', async () => {
      const nakesToken = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const client = await connectClient(nakesToken, 'auth')
      expect(client.connected).toBe(true)
      client.disconnect()
    })

    it('menerima koneksi NAKES via Authorization header', async () => {
      const nakesToken = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const client = await connectClient(nakesToken, 'header')
      expect(client.connected).toBe(true)
      client.disconnect()
    })

    it('menerima koneksi ADMIN', async () => {
      const adminToken = signToken({ sub: 'admin-1', role: 'ADMIN' })
      const client = await connectClient(adminToken, 'auth')
      expect(client.connected).toBe(true)
      client.disconnect()
    })
  })

  describe('Room Scoping & Isolasi Event (docs/API.md §4.2 & §4.4)', () => {
    it('menyiarkan alert darurat prioritas ke nakes di puskesmas yang sama dan admin, serta mengisolasi dari nakes puskesmas lain', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const tokenNakes2 = signToken({ sub: 'nakes-2', role: 'NAKES' })
      const tokenAdmin = signToken({ sub: 'admin-1', role: 'ADMIN' })

      const clientNakes1 = await connectClient(tokenNakes1)
      const clientNakes2 = await connectClient(tokenNakes2)
      const clientAdmin = await connectClient(tokenAdmin)

      const receivedNakes1: any[] = []
      const receivedNakes2: any[] = []
      const receivedAdmin: any[] = []

      clientNakes1.on('emergency.priority', (event) => receivedNakes1.push(event))
      clientNakes2.on('emergency.priority', (event) => receivedNakes2.push(event))
      clientAdmin.on('emergency.priority', (event) => receivedAdmin.push(event))

      // Beri sedikit jeda agar listener socket terpasang
      await new Promise((r) => setTimeout(r, 50))

      const emergencyData: PriorityEmergencyEventData = {
        emergencyId: 'em-001',
        triggeredAt: '2026-08-16T02:01:00.000Z',
        triggerType: 'ANOMALY_HR',
        hrBpm: 145,
        patient: {
          id: 'patient-101',
          fullName: 'Bu Ratna Test',
          livingSituation: 'ALONE',
        },
        location: {
          lat: -7.79,
          lng: 110.37,
          accuracyM: 12,
        },
        escalationRunId: 'run-001',
        tier: 'NAKES',
        actionUrl: '/dashboard/alerts/em-001',
        puskesmasId: 'P1',
        districtCode: 'D1',
      }

      emitPriorityEmergency(ioServer, emergencyData)

      // Tunggu propagasi event
      await new Promise((r) => setTimeout(r, 100))

      // Verifikasi:
      // 1. Nakes 1 (Puskesmas P1) menerima
      expect(receivedNakes1).toHaveLength(1)
      expect(receivedNakes1[0].event).toBe('emergency.priority')
      expect(receivedNakes1[0].data.emergencyId).toBe('em-001')
      expect(receivedNakes1[0].data.patient.fullName).toBe('Bu Ratna Test')
      expect(receivedNakes1[0].data.hrBpm).toBe(145)

      // 2. Nakes 2 (Puskesmas P2) TIDAK menerima (ISOLASI BERHASIL)
      expect(receivedNakes2).toHaveLength(0)

      // 3. Admin menerima
      expect(receivedAdmin).toHaveLength(1)
      expect(receivedAdmin[0].data.emergencyId).toBe('em-001')

      clientNakes1.disconnect()
      clientNakes2.disconnect()
      clientAdmin.disconnect()
    })

    it('menyiarkan alert ke nakes puskesmas P2 saat pasien berada di bawah Puskesmas P2', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const tokenNakes2 = signToken({ sub: 'nakes-2', role: 'NAKES' })

      const clientNakes1 = await connectClient(tokenNakes1)
      const clientNakes2 = await connectClient(tokenNakes2)

      const receivedNakes1: any[] = []
      const receivedNakes2: any[] = []

      clientNakes1.on('emergency.priority', (event) => receivedNakes1.push(event))
      clientNakes2.on('emergency.priority', (event) => receivedNakes2.push(event))

      await new Promise((r) => setTimeout(r, 50))

      const emergencyDataP2: PriorityEmergencyEventData = {
        emergencyId: 'em-002',
        triggeredAt: '2026-08-16T03:00:00.000Z',
        triggerType: 'MANUAL_SOS',
        patient: {
          id: 'patient-202',
          fullName: 'Pak Budi Test',
        },
        puskesmasId: 'P2',
        districtCode: 'D2',
      }

      emitPriorityEmergency(ioServer, emergencyDataP2)

      await new Promise((r) => setTimeout(r, 100))

      // Nakes 2 menerima
      expect(receivedNakes2).toHaveLength(1)
      expect(receivedNakes2[0].data.emergencyId).toBe('em-002')

      // Nakes 1 TIDAK menerima
      expect(receivedNakes1).toHaveLength(0)

      clientNakes1.disconnect()
      clientNakes2.disconnect()
    })
  })

  describe('Client Event: subscribe.scope (docs/API.md §4.3)', () => {
    it('mengizinkan nakes subscribe ke scope puskesmas yang ditugaskan', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const client = await connectClient(tokenNakes1)

      const res = await new Promise<any>((resolve) => {
        client.emit('subscribe.scope', { scope: 'puskesmas', id: 'P1' }, (ack: any) => {
          resolve(ack)
        })
      })

      expect(res).toEqual({ status: 'ok', scope: 'puskesmas', id: 'P1' })
      client.disconnect()
    })

    it('menolak nakes subscribe ke scope puskesmas di luar penugasan', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const client = await connectClient(tokenNakes1)

      const res = await new Promise<any>((resolve) => {
        client.emit('subscribe.scope', { scope: 'puskesmas', id: 'P2' }, (ack: any) => {
          resolve(ack)
        })
      })

      expect(res.status).toBe('error')
      expect(res.code).toBe('FORBIDDEN')
      client.disconnect()
    })

    it('mengizinkan admin subscribe ke scope manapun', async () => {
      const tokenAdmin = signToken({ sub: 'admin-1', role: 'ADMIN' })
      const client = await connectClient(tokenAdmin)

      const res = await new Promise<any>((resolve) => {
        client.emit('subscribe.scope', { scope: 'puskesmas', id: 'P99' }, (ack: any) => {
          resolve(ack)
        })
      })

      expect(res).toEqual({ status: 'ok', scope: 'puskesmas', id: 'P99' })
      client.disconnect()
    })
  })

  describe('Client Event: emergency.ack (docs/API.md §4.3)', () => {
    it('mengakui penanganan alert emergency dengan metadata user dan timestamp', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const client = await connectClient(tokenNakes1)

      const ackRes = await new Promise<any>((resolve) => {
        client.emit('emergency.ack', { emergencyId: 'em-101' }, (res: any) => {
          resolve(res)
        })
      })

      expect(ackRes.status).toBe('ok')
      expect(ackRes.emergencyId).toBe('em-101')
      expect(ackRes.ackByUserId).toBe('nakes-1')
      expect(ackRes.ackAt).toBeDefined()

      client.disconnect()
    })
  })

  describe('Helper Event Emitters (docs/API.md §4.3)', () => {
    it('emitEscalationStep mengirim event ke puskesmas nakes dan admin', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const tokenNakes2 = signToken({ sub: 'nakes-2', role: 'NAKES' })
      const clientNakes1 = await connectClient(tokenNakes1)
      const clientNakes2 = await connectClient(tokenNakes2)

      const nakes1Events: any[] = []
      const nakes2Events: any[] = []
      clientNakes1.on('escalation.step', (e) => nakes1Events.push(e))
      clientNakes2.on('escalation.step', (e) => nakes2Events.push(e))

      await new Promise((r) => setTimeout(r, 50))

      emitEscalationStep(ioServer, {
        runId: 'run-step-1',
        tier: 'NAKES',
        status: 'NAKES',
        contactSummary: 'Dr. Budi',
        puskesmasId: 'P1',
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(nakes1Events).toHaveLength(1)
      expect(nakes1Events[0].data.runId).toBe('run-step-1')
      expect(nakes2Events).toHaveLength(0)

      clientNakes1.disconnect()
      clientNakes2.disconnect()
    })

    it('emitRiskUpdated mengirim event ke puskesmas nakes dan admin', async () => {
      const tokenNakes1 = signToken({ sub: 'nakes-1', role: 'NAKES' })
      const tokenNakes2 = signToken({ sub: 'nakes-2', role: 'NAKES' })
      const clientNakes1 = await connectClient(tokenNakes1)
      const clientNakes2 = await connectClient(tokenNakes2)

      const nakes1Events: any[] = []
      const nakes2Events: any[] = []
      clientNakes1.on('risk.updated', (e) => nakes1Events.push(e))
      clientNakes2.on('risk.updated', (e) => nakes2Events.push(e))

      await new Promise((r) => setTimeout(r, 50))

      emitRiskUpdated(ioServer, {
        patientId: 'patient-101',
        riskLevel: 'HIGH',
        score: 85,
        puskesmasId: 'P1',
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(nakes1Events).toHaveLength(1)
      expect(nakes1Events[0].data.riskLevel).toBe('HIGH')
      expect(nakes2Events).toHaveLength(0)

      clientNakes1.disconnect()
      clientNakes2.disconnect()
    })

    it('emitComplianceUpdated mengirim event ke patient room', () => {
      expect(() => {
        emitComplianceUpdated(ioServer, {
          patientId: 'patient-101',
          scheduleId: 'sch-001',
          status: 'CONFIRMED',
        })
      }).not.toThrow()
    })
  })

  describe('Fastify Lifecycle Integration', () => {
    it('buildApp menginisialisasi WS server pada ready dan membersihkannya pada close', async () => {
      const { buildApp } = await import('../../app')
      const testApp = await buildApp({ logger: false, enableWs: true })

      await testApp.ready()
      const server = getDashboardWsServer()
      expect(server).not.toBeNull()

      await testApp.close()
      // Setelah close, getDashboardWsServer sudah dibersihkan
      expect(getDashboardWsServer()).toBeNull()
    })
  })
})
