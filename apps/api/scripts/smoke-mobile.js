// Smoke test integrasi mobile: endpoint yang dipanggil apps/mobile + deep link.
const { api, check, section, summary, assert, login, setToken } = require('./smoke-harness.js')

const RATEWA = '081200000002'   // Pak Haji (role PATIENT)
const RATNA = '081200000001'   // Bu Ratna

async function patientToken(phone) {
  const req = await api('/v1/auth/otp/request', { method: 'POST', body: { phone } })
  if (req.status === 429) {
    // Cooldown OTP 30 detik bekerja benar; tunggu sesuai petunjuk server.
    const wait = (req.error?.details?.retryAfterSec ?? 30) + 1
    console.log(`    (menunggu ${wait} detik karena cooldown OTP)`)
    await new Promise((r) => setTimeout(r, wait * 1000))
    await api('/v1/auth/otp/request', { method: 'POST', body: { phone } })
  } else if (req.status !== 200 && req.status !== 201) {
    throw new Error(`otp request: ${req.status} ${JSON.stringify(req.error)}`)
  }
  const v = await api('/v1/auth/otp/verify', { method: 'POST', body: { phone, otp: '123456' } })
  if (v.status !== 200) throw new Error(`otp ${phone}: ${v.status} ${JSON.stringify(v.error)}`)
  return v.data
}

async function main() {
  section('MOBILE — OTP auth')
  await check('OTP request → verify → token', async () => {
    const d = await patientToken(RATEWA)
    setToken('pasien', d.accessToken)
    return `${d.user.fullName}, role=${d.user.role}`
  })
  await check('OTP dengan kode salah ditolak', async () => {
    const r = await api('/v1/auth/otp/verify', { method: 'POST', body: { phone: RATNA, otp: '000000' } })
    assert(r.status >= 400, `harusnya ditolak, dapat ${r.status}`)
    return `HTTP ${r.status} ${r.error?.code ?? ''}`
  })

  section('MOBILE — endpoint yang dipanggil layar')
  await check('GET /v1/patients/me/reminders ( layar "Sudah Minum")', async () => {
    const r = await api('/v1/patients/me/reminders', { role: 'pasien' })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    return `${r.data.length} jadwal`
  })
  await check('GET /v1/patients/me/medications', async () => {
    const r = await api('/v1/patients/me/medications', { role: 'pasien' })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    return `${r.data.length} resep`
  })
  await check('POST /v1/compliance/confirm (1-tap "Sudah Minum")', async () => {
    const rem = await api('/v1/patients/me/reminders', { role: 'pasien' })
    const sched = rem.data[0]
    assert(sched, 'tidak ada jadwal untuk dikonfirmasi')
    const r = await api('/v1/compliance/confirm', { method: 'POST', role: 'pasien',
      body: { scheduleId: sched.id, channel: 'IN_APP' } })
    // Sudah dikonfirmasi sebelumnya bisa jadi 409 — itu perilaku idempotensi yang benar.
    assert([200, 409].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    return r.status === 200 ? `CONFIRMED (${r.data.status})` : '409 idempoten (sudah dikonfirmasi)'
  })
  await check('POST /v1/compliance/confirm jadwal orang lain → 403', async () => {
    const r = await api('/v1/compliance/confirm', { method: 'POST', role: 'pasien',
      body: { scheduleId: '00000000-0000-4000-8000-000000000301' } })
    assert([403, 404].includes(r.status), `harusnya 403/404, dapat ${r.status}`)
    return `HTTP ${r.status}`
  })
  await check('POST /v1/emergencies/:id/respond (layar darurat)', async () => {
    const r = await api('/v1/emergencies/00000000-0000-4000-8000-000000000000/respond',
      { method: 'POST', role: 'pasien', body: { response: 'SAFE' } })
    assert([404, 400].includes(r.status), `harusnya 404/400, dapat ${r.status}`)
    return `HTTP ${r.status} (emergency tidak ada)`
  })
  await check('GET /v1/medication-requests (permintaan obat)', async () => {
    const r = await api('/v1/medication-requests', { role: 'pasien' })
    assert([200, 403].includes(r.status), `status ${r.status}`)
    return `HTTP ${r.status}${r.status === 200 ? ` (${r.data.length} request)` : ''}`
  })

  section('MOBILE — deep link (careloop://)')
  const link = require('../../mobile/src/services/linking.ts')
  await check('createConfirmationDeepLink → parseConfirmationUrl (round-trip)', async () => {
    const id = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
    const url = link.createConfirmationDeepLink(id)
    const parsed = link.parseConfirmationUrl(url)
    assert(parsed.action === 'confirm', `action=${parsed.action}`)
    assert(parsed.scheduleId === id, `scheduleId=${parsed.scheduleId}`)
    return url
  })
  await check('createEmergencyDeepLink → parseConfirmationUrl (round-trip)', async () => {
    const id = '33333333-3333-4333-8333-333333333333'
    const url = link.createEmergencyDeepLink(id)
    const parsed = link.parseConfirmationUrl(url)
    assert(parsed.action === 'emergency', `action=${parsed.action}`)
    assert(parsed.emergencyId === id, `emergencyId=${parsed.emergencyId}`)
    return url
  })
  await check('varian URL dari WhatsApp (https + path) tetap diparse', async () => {
    const cases = [
      ['https://careloop.id/confirm/abc-123', 'confirm', 'abc-123'],
      ['https://careloop.id/confirm?scheduleId=xyz-9', 'confirm', 'xyz-9'],
      ['https://careloop.id/emergency/eee-4', 'emergency', 'eee-4'],
    ]
    for (const [url, action, id] of cases) {
      const p = link.parseConfirmationUrl(url)
      assert(p.action === action, `${url} -> action=${p.action}`)
      const got = p.scheduleId || p.emergencyId
      assert(got === id, `${url} -> id=${got}`)
    }
    return `${cases.length} varian OK`
  })
  await check('URL sampah tidak membuat crash', async () => {
    // null/empty dikembalikan apa adanya; string tak dikenal menjadi action 'unknown'.
    // Dua-duanya aman karena layar hanya bereaksi pada 'confirm'/'emergency'.
    for (const bad of [null, undefined, '']) {
      assert(link.parseConfirmationUrl(bad) === null, `input kosong harus null: ${String(bad)}`)
    }
    for (const bad of ['   ', 'https://example.com', 'random', 'careloop://confirm']) {
      const p = link.parseConfirmationUrl(bad)
      assert(p !== null, `${bad} -> null`)
      assert(['confirm', 'emergency', 'unknown'].includes(p.action), `${bad} -> ${p.action}`)
    }
    return 'aman (null atau unknown, tidak crash)'
  })
}

main().then(() => process.exit(summary('MOBILE')))
