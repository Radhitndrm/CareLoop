// Harness smoke test HTTP: menguji API CareLoop yang sedang berjalan sungguhan.
// Dipakai untuk pass manual "test semua fitur" — bukan bagian dari suite vitest.
const BASE = process.env.BASE || 'http://localhost:4000'
const TOKENS = {}

function setToken(role, token) { TOKENS[role] = token }
function token(role) { return TOKENS[role] }

async function api(path, opts = {}) {
  const { method = 'GET', body, role, headers = {} } = opts
  const h = { Accept: 'application/json', ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const t = role && TOKENS[role]
  if (t) h.Authorization = 'Bearer ' + t

  // Timeout wajib: tanpa ini, request yang menggantung (mis. BullMQ menunggu Redis
  // yang mati) membuat seluruh run terlihat diam-diam membeku.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.SMOKE_TIMEOUT_MS || 15000))

  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: h,
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    clearTimeout(timer)
    const why = e.name === 'AbortError' ? 'timeout (server tidak merespons)' : e.message
    throw new Error(`${method} ${path} — ${why}`)
  }
  clearTimeout(timer)
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { _raw: text.slice(0, 200) } }
  return { status: res.status, body: parsed, data: parsed && parsed.data, meta: parsed && parsed.meta, error: parsed && parsed.error }
}

const results = []

async function check(name, fn) {
  try {
    const r = await fn()
    results.push({ name, ok: true, detail: r || '' })
    console.log(`  \x1b[32m+\x1b[0m ${name}${r ? ' — ' + r : ''}`)
    return r
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
    console.log(`  \x1b[31mX\x1b[0m ${name} — ${e.message}`)
    return null
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
  return true
}

function section(title) { console.log(`\n\x1b[1m${title}\x1b[0m`) }

function summary(label) {
  const pass = results.filter((r) => r.ok).length
  const fail = results.length - pass
  console.log('\n' + '='.repeat(62))
  console.log(`${label}  TOTAL ${results.length} | lulus ${pass} | gagal ${fail}`)
  if (fail) {
    console.log('\nGAGAL:')
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`)
  }
  console.log('='.repeat(62))
  return fail
}

async function login(role, identifier, password) {
  const r = await api('/v1/auth/login', { method: 'POST', body: { phone: identifier, password } })
  if (r.status !== 200) throw new Error(`login ${role}: ${r.status} ${JSON.stringify(r.error)}`)
  setToken(role, r.data.accessToken)
  return r.data.user
}

module.exports = { BASE, api, check, assert, section, summary, login, setToken, token, results }
