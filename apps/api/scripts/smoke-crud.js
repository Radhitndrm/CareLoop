// Smoke test CRUD: dashboard, pasien, obat, jadwal, kontak, farmasi, puskesmas.
const { api, check, section, summary, assert, login } = require('./smoke-harness.js')

const UNIQ = Date.now().toString().slice(-6)
const ctx = {}

async function main() {
  section('PERSIAPAN — login semua role')
  for (const [role, phone] of [
    ['dokter', '081100000001'],
    ['perawat', '081100000004'],
    ['admin', '081100000003'],
    ['apotek', '081100000005'],
  ]) {
    await check(`login ${role}`, async () => {
      const u = await login(role, phone, 'CareLoop#Demo2026')
      return `${u.fullName} (${u.nakesRole || u.role})`
    })
  }

  section('DASHBOARD')
  await check('GET /v1/dashboard/summary', async () => {
    const r = await api('/v1/dashboard/summary', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.totalPatients >= 2, `totalPatients=${r.data.totalPatients}`)
    return `${r.data.totalPatients} pasien, adherensi ${r.data.adherenceRate}`
  })
  await check('GET /v1/dashboard/adherence', async () => {
    const r = await api('/v1/dashboard/adherence', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(Array.isArray(r.data.series), 'series bukan array')
    return `${r.data.series.length} titik`
  })
  await check('GET /v1/dashboard/alerts', async () => {
    const r = await api('/v1/dashboard/alerts', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    return `${r.data.totalActive} alert aktif`
  })
  await check('GET /v1/dashboard/work-queue', async () => {
    const r = await api('/v1/dashboard/work-queue', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    return `${r.data.length} kelompok`
  })

  section('PASIEN — CRUD penuh')
  await check('CREATE /v1/patients', async () => {
    const r = await api('/v1/patients', {
      method: 'POST', role: 'dokter',
      body: { fullName: `Uji CRUD ${UNIQ}`, phone: `0815${UNIQ}000`, districtCode: '3471',
        puskesmasId: '00000000-0000-4000-8000-000000000001',
        livingSituation: 'WITH_FAMILY', healthConditions: ['HYPERTENSION'] },
    })
    assert([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    ctx.patientId = r.data.id
    return `id=${ctx.patientId} status=${r.data.status}`
  })
  await check('READ /v1/patients/:id', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}`, { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.fullName === `Uji CRUD ${UNIQ}`, 'nama tidak cocok')
    return r.data.fullName
  })
  await check('LIST + SEARCH /v1/patients', async () => {
    const r = await api(`/v1/patients?search=Uji+CRUD+${UNIQ}`, { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    assert(r.data.some((p) => p.id === ctx.patientId), 'pasien tidak ditemukan')
    return `${r.data.length} hasil`
  })
  await check('LOOKUP /v1/patients/lookup (pasien sendiri = IN_SCOPE)', async () => {
    const r = await api(`/v1/patients/lookup?phone=0815${UNIQ}000`, { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    // Pasien dalam scope bukan "konflik" — konflik dipakai untuk nomor yang sudah dipakai
    // pasien DI LUAR wilayah, supaya operator tidak bisa mengambil alih.
    assert(r.data.hasConflict === false, `hasConflict=${r.data.hasConflict}`)
    assert(r.data.matches[0]?.kind === 'IN_SCOPE', `kind=${r.data.matches[0]?.kind}`)
    return r.data.matches[0].hint.slice(0, 52)
  })
  await check('UPDATE hr-thresholds', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}/hr-thresholds`, {
      method: 'PUT', role: 'dokter', body: { hrMinBpm: 50, hrMaxBpm: 110 } })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    assert(r.data.hrMaxBpm === 110, `hrMaxBpm=${r.data.hrMaxBpm}`)
    return 'hrMax=110'
  })
  await check('CREATE kontak keluarga', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}/family-contacts`, {
      method: 'POST', role: 'dokter',
      body: { name: `Keluarga ${UNIQ}`, phone: `0816${UNIQ}000`, relationship: 'ANAK', tier: 'TIER_1' } })
    assert([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    ctx.familyId = r.data.id
    return `id=${ctx.familyId}`
  })
  await check('UPDATE kontak keluarga', async () => {
    const r = await api(`/v1/family-contacts/${ctx.familyId}`, {
      method: 'PUT', role: 'dokter',
      body: { name: `Keluarga ${UNIQ}`, phone: `0816${UNIQ}000`, relationship: 'ANAK', tier: 'TIER_1', canViewHealth: true, canReceiveEmergency: true } })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    return r.data.tier
  })
  await check('LIST kontak keluarga', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}/family-contacts`, { role: 'dokter' })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    assert(r.data.length >= 1, 'kontak kosong')
    return `${r.data.length} kontak`
  })

  section('OBAT — gate persetujuan klinis')
  await check('CREATE obat (perawat boleh draft)', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}/medications`, {
      method: 'POST', role: 'perawat',
      body: { name: `Amlodipine Uji ${UNIQ}`, dosage: '5 mg', form: 'TABLET', startedAt: '2026-08-01' } })
    assert([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    ctx.medId = r.data.id
    assert(r.data.status === 'DRAFT', `status harus DRAFT, dapat ${r.data.status}`)
    return `id=${ctx.medId} DRAFT`
  })
  await check('APPROVE oleh perawat harus 403', async () => {
    const r = await api(`/v1/medications/${ctx.medId}/approve`, {
      method: 'POST', role: 'perawat', body: { decision: 'APPROVED' } })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })
  await check('APPROVE oleh apotek harus 403', async () => {
    const r = await api(`/v1/medications/${ctx.medId}/approve`, {
      method: 'POST', role: 'apotek', body: { decision: 'APPROVED' } })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })
  await check('APPROVE oleh dokter harus 200', async () => {
    const r = await api(`/v1/medications/${ctx.medId}/approve`, {
      method: 'POST', role: 'dokter', body: { decision: 'APPROVED', note: 'Disetujui untuk uji' } })
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.error)}`)
    assert(r.data.status === 'APPROVED', `status=${r.data.status}`)
    return 'APPROVED'
  })
  await check('CREATE jadwal (setelah resep APPROVED)', async () => {
    const r = await api(`/v1/patients/${ctx.patientId}/schedules`, {
      method: 'POST', role: 'perawat',
      body: { medicationId: ctx.medId, timeOfDay: '07:00', doseQty: '1 tablet', startDate: '2026-08-01' } })
    assert([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    ctx.scheduleId = r.data.schedules.at(-1).id
    return `scheduleId=${ctx.scheduleId}`
  })
  await check('nakes tidak bisa akses /patients/me/reminders', async () => {
    const r = await api('/v1/patients/me/reminders', { role: 'dokter' })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })

  section('FARMASI')
  await check('LIST /v1/medication-requests (apotek boleh)', async () => {
    const r = await api('/v1/medication-requests', { role: 'apotek' })
    assert(r.status === 200, `status ${r.status}`)
    // Bentuk respons: array di `data`, ringkasan di `meta`.
    assert(Array.isArray(r.data), 'data bukan array')
    return `${r.data.length} request, ${JSON.stringify(r.meta?.summary ?? {})}`
  })
  await check('apotek tidak boleh buat request obat', async () => {
    const r = await api('/v1/medication-requests', {
      method: 'POST', role: 'apotek',
      body: { medicationId: ctx.medId, requestedQuantity: 30, reasonCode: 'STOCK_OUT' } })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })
  await check('GET /v1/dispensing-records', async () => {
    const r = await api('/v1/dispensing-records', { role: 'apotek' })
    assert(r.status === 200, `status ${r.status}`)
    return `${r.data.length} catatan`
  })

  section('PUSKESMAS & ADMIN')
  await check('LIST /v1/puskesmas', async () => {
    const r = await api('/v1/puskesmas', { role: 'dokter' })
    assert(r.status === 200, `status ${r.status}`)
    return `${r.data.length} puskesmas`
  })
  await check('CREATE puskesmas (admin)', async () => {
    const r = await api('/v1/admin/puskesmas', {
      method: 'POST', role: 'admin',
      body: { name: `Puskesmas Uji ${UNIQ}`, type: 'PUSKESMAS', districtCode: '3472' } })
    assert([200, 201].includes(r.status), `status ${r.status} ${JSON.stringify(r.error)}`)
    ctx.clinicId = r.data.id
    return `id=${ctx.clinicId}`
  })
  await check('CREATE pus—by non-admin harus 403', async () => {
    const r = await api('/v1/admin/puskesmas', {
      method: 'POST', role: 'dokter',
      body: { name: 'Pus legalize', type: 'PUSKESMAS', districtCode: '3472' } })
    assert(r.status === 403, `harusnya 403, dapat ${r.status}`)
    return '403 sesuai'
  })

  section('MODUL YANG BELUM PUNYA TEST FILE')
  for (const [label, path, role] of [
    ['GET /v1/facilities/nearby', '/v1/facilities/nearby?lat=-7.8&lng=110.3&radiusKm=5', 'dokter'],
    ['GET /v1/export/jobs', '/v1/export/jobs', 'admin'],
    ['GET /v1/education/topics', '/v1/education/topics', 'dokter'],
    ['GET /v1/patients/me/risk', '/v1/patients/me/risk', 'dokter'],
    ['GET /v1/admin/nakes-accounts', '/v1/admin/nakes-accounts', 'admin'],
    ['GET /v1/escalations/active', '/v1/escalations/active', 'dokter'],
    ['GET /v1/emergencies/active', '/v1/emergencies/active', 'dokter'],
    ['GET /v1/patients/:id/compliance', `/v1/patients/${ctx.patientId}/compliance`, 'dokter'],
  ]) {
    await check(label, async () => {
      const r = await api(path, { role })
      assert(r.status < 500, `status ${r.status} — 500 = crash`)
      const env = r.body && r.body.status ? ` envelope=${r.body.status}` : ''
      return `HTTP ${r.status}${env}`
    })
  }

  section('CLEANUP')
  await check('DELETE kontak keluarga', async () => {
    const r = await api(`/v1/family-contacts/${ctx.familyId}`, { method: 'DELETE', role: 'dokter' })
    assert([200, 204].includes(r.status), `status ${r.status}`)
    return 'terhapus'
  })
}

main().then(() => process.exit(summary('CRUD')))
