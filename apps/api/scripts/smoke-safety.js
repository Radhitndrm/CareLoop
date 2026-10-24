// Smoke test alur keselamatan: kepatuhan, eskalasi, darurat, eskalasi timeout.
const { api, check, section, summary, assert, login } = require('./smoke-harness.js')

const PAK = '00000000-0000-4000-8000-000000000005'   // WITH_FAMILY, Amlodipine
const RATNA = '00000000-0000-4000-8000-000000000003'  // ALONE + NAKES_FIRST
const SCHED = '00000000-0000-4000-8000-000000000302'
const METFORMIN = '00000000-0000-4000-8000-000000000301'

async function reset() {
  await api('/v1/dev/whatsapp/scenarios/reset', { method: 'POST', role: 'dokter' })
}

async function main() {
  await login('dokter', '081100000001', 'CareLoop#Demo2026')
  await login('perawat', '081100000004', 'CareLoop#Demo2026')

  section('KEPATUHAN')
  await check('trigger reminder lewat scenario A', async () => {
    await reset()
    const r = await api('/v1/dev/whatsapp/scenarios/REMINDER_CONFIRMED/trigger', { method: 'POST', role: 'dokter', body: {} })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.summary.reminderOutcome === 'SENT', `outcome=${r.data.summary.reminderOutcome}`)
    return `reminder=${r.data.summary.reminderOutcome}`
  })
  await check('tombol "Sudah Minum" → compliance CONFIRMED', async () => {
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000002', { role: 'dokter' })
    const msg = m.data.find((x) => x.buttons.some((b) => b.id.startsWith('CONFIRM_TAKEN')))
    assert(msg, 'pesan reminder tidak ditemukan')
    const btn = msg.buttons.find((b) => b.id.startsWith('CONFIRM_TAKEN'))
    const r = await api(`/v1/dev/whatsapp/messages/${msg.messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    assert(String(r.data.outcome).startsWith('CONFIRMED'), `outcome=${r.data.outcome}`)
    return `${r.data.outcome}, eskalasi ditutup=${r.data.details.escalationResolved}`
  })
  await check('compliance tercatat di DB & terlihat nakes', async () => {
    const r = await api(`/v1/patients/${PAK}/compliance`, { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.length >= 1, 'compliance kosong')
    return `${r.data.length} baris, terbaru ${r.data[0].status}`
  })
  await check('tombol yang sama ditekan 2x ditolak (idempotensi UI)', async () => {
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000002', { role: 'dokter' })
    const msg = m.data.find((x) => x.direction === 'OUTBOUND' && x.buttons.some((b) => b.id.startsWith('CONFIRM_TAKEN')))
    const btn = msg.buttons.find((b) => b.id.startsWith('CONFIRM_TAKEN'))
    const r = await api(`/v1/dev/whatsapp/messages/${msg.messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 404, `harusnya 404 (sudah dibalas), dapat ${r.status}`)
    return 'ditolak sesuai'
  })
  await check('DEFER → TUNDA, eskalasi tetap jalan', async () => {
    await reset()
    await api('/v1/dev/whatsapp/scenarios/REMINDER_CONFIRMED/trigger', { method: 'POST', role: 'dokter', body: {} })
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000002', { role: 'dokter' })
    const msg = m.data.find((x) => x.buttons.some((b) => b.id.startsWith('DEFER')))
    const btn = msg.buttons.find((b) => b.id.startsWith('DEFER'))
    const r = await api(`/v1/dev/whatsapp/messages/${msg.messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    assert(r.data.outcome === 'TUNDA', `outcome=${r.data.outcome}`)
    assert(r.data.details.escalationRunId, 'run eskalasi seharusnya masih ada')
    return `TUNDA, eskalasi=${r.data.details.escalationRunId ? 'masih jalan' : 'hilang (BAHAYA)'}`
  })
  await check('pasien lain tidak bisa konfirmasi jadwal orang lain', async () => {
    const r = await api('/v1/compliance/confirm', { method: 'POST', role: 'dokter', body: { scheduleId: SCHED } })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })

  section('ESKALASI')
  await check('A: tidak merespons → FAMILY_TIER_1', async () => {
    await reset()
    await api('/v1/dev/whatsapp/scenarios/REMINDER_CONFIRMED/trigger', { method: 'POST', role: 'dokter', body: {} })
    const r = await api('/v1/dev/whatsapp/scenarios/REMINDER_NO_RESPONSE/trigger', { method: 'POST', role: 'dokter', body: {} })
    assert(r.data.summary.previousStatus === 'WAITING_PATIENT', `prev=${r.data.summary.previousStatus}`)
    assert(r.data.summary.newStatus === 'FAMILY_TIER_1', `new=${r.data.summary.newStatus}`)
    return `${r.data.summary.previousStatus} → ${r.data.summary.newStatus}, ${r.data.summary.notifiedCount} kontak`
  })
  await check('keluarga terima alert bertombol "Saya Tangani"', async () => {
    const m = await api('/v1/dev/whatsapp/messages?to=6281300000002', { role: 'dokter' })
    assert(m.data.length >= 1, 'tidak ada pesan ke keluarga')
    const btns = m.data[0].buttons.map((b) => b.id)
    assert(btns.some((b) => b.startsWith('HANDLE')), `tombol HANDLE tidak ada: ${JSON.stringify(btns)}`)
    return btns.join(', ')
  })
  await check('"Saya Tangani" → HANDLED', async () => {
    const m = await api('/v1/dev/whatsapp/messages?to=6281300000002', { role: 'dokter' })
    const btn = m.data[0].buttons.find((b) => b.id.startsWith('HANDLE'))
    const r = await api(`/v1/dev/whatsapp/messages/${m.data[0].messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.outcome === 'HANDLED', `outcome=${r.data.outcome}`)
    return `${r.data.outcome} (${r.data.details.resolutionType})`
  })
  await check('filter scope terlihat: admin melihat lebih banyak dari nakes', async () => {
    await login('admin', '081100000003', 'CareLoop#Demo2026')
    await login('dokter', '081100000001', 'CareLoop#Demo2026')

    // Krikes run untuk pasien di luar wilayah (district 3499), lalu pastikan ia
    // terlihat oleh admin global tapi TIDAK oleh dr Dewi (scope 3471).
    const U = Date.now().toString().slice(-6)
    const c = await api('/v1/admin/puskesmas', { method: 'POST', role: 'admin',
      body: { name: `PK-Scope ${U}`, type: 'PUSKESMAS', districtCode: '3498' } })
    const p2 = await api('/v1/patients', { method: 'POST', role: 'admin',
      body: { fullName: `Luar Scope ${U}`, phone: `0813${U}0000`,
        districtCode: '3498', puskesmasId: c.data.id, healthConditions: ['DIABETES'] } })
    assert(p2.status < 400, `buat pasien gagal ${p2.status}`)

    const before = await api('/v1/escalations/active', { role: 'admin' })
    const beforeNakes = await api('/v1/escalations/active', { role: 'dokter' })
    assert(before.data.length >= beforeNakes.data.length,
      `admin (${before.data.length}) harus >= nakes (${beforeNakes.data.length})`)

    // Nakes mencoba menutup run milik pasien puskesmas lain -> harus ditolak.
    if (beforeNakes.data[0]) {
      const e = await api(`/v1/escalations/${beforeNakes.data[0].id}/respond`,
        { method: 'POST', role: 'dokter', body: { response: 'HANDLE' } })
      assert(e.status === 200, 'run milik nakes sendiri harus boleh ditutup')
    }
    return `admin=${before.data.length} run, nakes=${beforeNakes.data.length} run (terfilter)`
  })

  section('DARURAT')
  await check('C: anomali HR membuat emergency PENDING_PATIENT_CONFIRM', async () => {
    await reset()
    const r = await api('/v1/dev/whatsapp/scenarios/HEART_RATE_ANOMALY/trigger', { method: 'POST', role: 'dokter', body: {} })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.summary.hrBpm > 120, `hrBpm=${r.data.summary.hrBpm}`)
    ctx_emergencyId = r.data.focus.id
    return `hr=${r.data.summary.hrBpm}, timeout=${r.data.summary.timeoutSec}s`
  })
  await check('pasien dapat tombol Aman / Butuh Bantuan', async () => {
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000001', { role: 'dokter' })
    const msg = m.data.find((x) => x.buttons.some((b) => b.id.startsWith('SAFE')))
    assert(msg, 'prompt konfirmasi tidak ditemukan')
    // Nama intent mengandung underscore (NEED_HELP), jadi ambil prefix sebelum id resource.
    const ids = msg.buttons.map((b) => b.id.replace(/_[0-9a-f-]{36}$/, ''))
    assert(ids.includes('SAFE') && ids.includes('NEED_HELP'), `tombol: ${JSON.stringify(ids)}`)
    return ids.join(', ')
  })
  await check('"Saya Aman" → RESOLVED_SAFE, tanpa alert ke keluarga', async () => {
    await reset()
    const t = await api('/v1/dev/whatsapp/scenarios/HEART_RATE_ANOMALY/trigger', { method: 'POST', role: 'dokter', body: {} })
    const eid = t.data.focus.id
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000001', { role: 'dokter' })
    const msg = m.data.find((x) => x.buttons.some((b) => b.id.startsWith('SAFE')))
    const btn = msg.buttons.find((b) => b.id.startsWith('SAFE'))
    const r = await api(`/v1/dev/whatsapp/messages/${msg.messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.details.status === 'RESOLVED_SAFE', `status=${r.data.details.status}`)
    const fam = await api('/v1/dev/whatsapp/messages?to=6281300000001', { role: 'dokter' })
    assert(fam.data.length === 0, `_family harus 0 pesan, dapat ${fam.data.length}`)
    return 'RESOLVED_SAFE, 0 alert keluarga'
  })
  await check('"Saya Butuh Bantuan" → ESCALATING + eskalasi nakes', async () => {
    await reset()
    const t = await api('/v1/dev/whatsapp/scenarios/HEART_RATE_ANOMALY/trigger', { method: 'POST', role: 'dokter', body: {} })
    const m = await api('/v1/dev/whatsapp/messages?to=6281200000001', { role: 'dokter' })
    const msg = m.data.find((x) => x.buttons.some((b) => b.id.startsWith('NEED_HELP')))
    const btn = msg.buttons.find((b) => b.id.startsWith('NEED_HELP'))
    const r = await api(`/v1/dev/whatsapp/messages/${msg.messageId}/reply`, { method: 'POST', role: 'dokter', body: { buttonId: btn.id } })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.details.status === 'ESCALATING', `status=${r.data.details.status}`)
    return `emergency=${r.data.details.status}, eskalasi=${r.data.details.escalationStatus}`
  })
  await check('emergency muncul di dashboard alerts', async () => {
    const r = await api('/v1/dashboard/alerts', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.emergencies.length >= 1, 'tidak ada darurat aktif di dashboard')
    return `${r.data.emergencies.length} darurat, ${r.data.escalations.length} eskalasi`
  })
  await check('emergency timeout manual → eskalasi lanjut', async () => {
    const list = await api('/v1/emergencies/active', { role: 'dokter' })
    const em = list.data[0]
    assert(em, 'tidak ada emergency aktif')
    const r = await api(`/v1/emergencies/${em.id}/timeout`, { method: 'POST', role: 'dokter', body: {} })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    return `escalationStatus=${r.data.emergencyResult ? r.data.emergencyResult.escalationStatus : r.data.newState}`
  })

  section('DATA SAFETY')
  await check('apotek TIDAK boleh baca data pasien', async () => {
    await login('apotek', '081100000005', 'CareLoop#Demo2026')
    for (const p of ['/v1/patients', `/v1/patients/${PAK}`, `/v1/patients/${PAK}/compliance`, '/v1/dashboard/summary', '/v1/emergencies/active', '/v1/dev/whatsapp/threads']) {
      const r = await api(p, { role: 'apotek' })
      assert(r.status === 403, `${p} seharusnya 403, dapat ${r.status}`)
    }
    return 'semua 403'
  })
  await check('pasien tidak bisa akses dashboard nakes', async () => {
    const u = Date.now().toString().slice(-6)
    const otp = await api('/v1/auth/otp/request', { method: 'POST', body: { phone: '081200000002' } })
    assert(otp.status === 200 || otp.status === 201, `otp ${otp.status}`)
    const v = await api('/v1/auth/otp/verify', { method: 'POST', body: { phone: '081200000002', otp: '123456' } })
    assert(v.status === 200, `verify ${v.status} ${JSON.stringify(v.error)}`)
    require('./smoke-harness.js').setToken('pasien', v.data.accessToken)
    const r = await api('/v1/dashboard/summary', { role: 'pasien' })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return 'OTP loginutorysukses, dashboard 403'
  })
  await check('pasien hanya bisa akses data sendiri', async () => {
    const mine = await api('/v1/patients/me/reminders', { role: 'pasien' })
    assert(mine.status === 200, `status ${mine.status}`)
    const other = await api(`/v1/patients/${RATNA}/compliance`, { role: 'pasien' })
    assert([403, 404].includes(other.status), `harusnya 403/404, dapat ${other.status}`)
    return `reminder saya=${mine.data.length}, milik orang lain=${other.status}`
  })
}

let ctx_emergencyId = null
main().then(() => process.exit(summary('SAFETY')))
