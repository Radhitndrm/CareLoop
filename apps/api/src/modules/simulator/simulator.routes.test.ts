// Guard WhatsApp Simulator (plan tasks/plan-whatsapp-mockup-demo.md Fase 3).
//
// Tiga hal yang dikunci suite ini:
//   1. Setiap route simulator wajib bertoken (AGENTS.md §2.8).
//   2. Apotek (NakesRole.FARMASI) tidak boleh menyentuh panel — isinya nomor HP & isi
//      pesan pasien (AGENTS.md §2.7).
//   3. Route mati total ketika SIMULATOR_ENABLED=false, dan pesan error memakai 404
//      supaya route-nya tidak bisa dipetakan dari luar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims } from '@careloop/shared'
import { resetEnvCache } from '../../lib/env'
import { resetWhatsAppSandbox } from '../../integrations/whatsapp'

const SIMULATOR_ROUTES: Array<{ method: 'GET' | 'POST'; url: string; label: string }> = [
  { method: 'GET', url: '/v1/dev/whatsapp/status', label: 'status simulator' },
  { method: 'GET', url: '/v1/dev/whatsapp/threads', label: 'daftar percakapan' },
  { method: 'GET', url: '/v1/dev/whatsapp/messages', label: 'isi percakapan' },
  {
    method: 'POST',
    url: '/v1/dev/whatsapp/messages/sbx_000001/reply',
    label: 'balas tombol',
  },
  {
    method: 'POST',
    url: '/v1/dev/whatsapp/scenarios/REMINDER_CONFIRMED/trigger',
    label: 'pemicu scenario',
  },
  { method: 'POST', url: '/v1/dev/whatsapp/scenarios/reset', label: 'reset demo' },
  { method: 'POST', url: '/v1/dev/whatsapp/provider-failure', label: 'sakelar kegagalan' },
]

const BASE_ENV = {
  DATABASE_URL: 'postgresql://localhost:5432/careloop_test?schema=public',
  JWT_SECRET: 'test-secret-minimal-32-karakter-abcdefg',
}

/**
 * Dua suite terpisah, bukan dua app di satu `describe`: `getEnv()` caches per proses,
 * jadi satu proses tidak bisa menjalankan instance "menyala" dan "mati" bersamaan.
 * Suite dijalankan berurutan, jadi env ditukar di batas yang benar.
 */
describe('guard WhatsApp Simulator (simulator aktif)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    Object.assign(process.env, BASE_ENV, { SIMULATOR_ENABLED: 'true' })
    resetEnvCache()
    resetWhatsAppSandbox()

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false, enableWs: false })
    await app.ready()
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  const headersFor = (claims: AuthUserClaims) => ({
    authorization: `Bearer ${app.jwt.sign(claims as any)}`,
  })

  const dokter = () =>
    headersFor({ sub: '11111111-1111-4111-8111-111111111111', role: 'NAKES', nakesRole: 'DOKTER' })
  const perawat = () =>
    headersFor({ sub: '22222222-2222-4222-8222-222222222222', role: 'NAKES', nakesRole: 'PERAWAT' })
  const apoteker = () =>
    headersFor({ sub: '33333333-3333-4333-8333-333333333333', role: 'NAKES', nakesRole: 'FARMASI' })

  it('semua route simulator menolak request tanpa token (401)', async () => {
    for (const route of SIMULATOR_ROUTES) {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} })
      expect(res.statusCode, `${route.label} harus 401`).toBe(401)
    }
  })

  it('apoteker ditolak 403 di semua route simulator', async () => {
    for (const route of SIMULATOR_ROUTES) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: apoteker(),
        payload: {},
      })
      expect(res.statusCode, `${route.label} harus 403 untuk apoteker`).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
    }
  })

  it('perawat boleh masuk ke panel (bukan hak klinis khusus, hanya akses simulator)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dev/whatsapp/threads',
      headers: perawat(),
    })
    expect(res.statusCode).not.toBe(401)
    expect(res.statusCode).not.toBe(403)
  })

  it('status simulator melaporkan provider mode dan scenario yang tersedia', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dev/whatsapp/status', headers: dokter() })
    expect(res.statusCode).toBe(200)

    const { data } = res.json()
    expect(data.enabled).toBe(true)
    expect(data.scenarios).toEqual(
      expect.arrayContaining([
        'REMINDER_CONFIRMED',
        'REMINDER_NO_RESPONSE',
        'HEART_RATE_ANOMALY',
        'PROVIDER_FAILURE',
      ]),
    )
  })

  it('balas tombol ditolak untuk pesan yang tidak ada / tombol milik pesan lain', async () => {
    const notFound = await app.inject({
      method: 'POST',
      url: '/v1/dev/whatsapp/messages/tidak-ada/reply',
      headers: dokter(),
      payload: { buttonId: 'CONFIRM_TAKEN_00000000-0000-4000-8000-000000000301' },
    })
    expect(notFound.statusCode).toBe(404)
  })

  it('scenario yang tidak dikenal ditolak 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/whatsapp/scenarios/JALAN_RANDOM/trigger',
      headers: dokter(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('guard WhatsApp Simulator (SIMULATOR_ENABLED=false)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    Object.assign(process.env, BASE_ENV, { SIMULATOR_ENABLED: 'false' })
    resetEnvCache()

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false, enableWs: false })
    await app.ready()
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  const nakesHeaders = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'NAKES',
      nakesRole: 'DOKTER',
    } as any)}`,
  })

  it('seluruh route simulator mengembalikan 404, bukan 403 — route-nya tidak boleh terpetakan', async () => {
    for (const route of SIMULATOR_ROUTES) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: nakesHeaders(),
        payload: {},
      })
      expect(res.statusCode, `${route.label} harus 404`).toBe(404)
      expect(res.json().error.code).toBe('NOT_FOUND')
    }
  })

  it('tetap menolak tanpa token walau simulator dimatikan (auth dicek lebih dulu)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dev/whatsapp/threads' })
    expect(res.statusCode).toBe(401)
  })
})
