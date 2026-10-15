# TESTING — Strategi & Rencana Testing CareLoop

**Versi:** 1.0 · **Terkait:** [PRD.md](PRD.md) (acceptance criteria), [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md)

Tujuan testing MVP: **memastikan jalur kritis (reminder → konfirmasi → eskalasi → darurat) berjalan benar dan bisa dibuktikan saat demo**, tanpa menghabiskan waktu tim.

---

## Daftar Isi

1. [Strategi & Piramida Testing](#1-strategi--piramida-testing)
2. [Tooling](#2-tooling)
3. [Unit Test](#3-unit-test)
4. [Integration Test (API)](#4-integration-test-api)
5. [E2E Test](#5-e2e-test)
6. [Test Case Prioritas: Eskalasi Darurat Bertingkat](#6-test-case-prioritas-eskalasi-darurat-bertingkat)
7. [Test Case Prioritas: Akurasi Reminder](#7-test-case-prioritas-akurasi-reminder)
8. [Test Case: Deteksi Anomali](#8-test-case-deteksi-anomali)
9. [Test Data & Fixture](#9-test-data--fixture)
10. [Integrasi Pihak Ketiga: WhatsApp API](#10-integrasi-pihak-ketiga-whatsapp-api)
11. [Integrasi Pihak Ketiga: Smartwatch API](#11-integrasi-pihak-ketiga-smartwatch-api)
12. [Testing di CI](#12-testing-di-ci)
13. [Definisi Selesai (Testing)](#13-definisi-selesai-testing)

---

## 1. Strategi & Piramida Testing

```
        ╭──────────╮
        │  E2E (5%) │   Playwright: demo journey end-to-end
        ╞══════════╡
        │ Integration │   Vitest+Supertest: API + DB + queue
        │   (25%)      │   fokus state machine eskalasi
        ╞══════════╡
        │   Unit       │   Service/rule/validator/template
        │   (70%)      │   cepat, tanpa infra
        ╰──────────╯
```

**Aturan untuk hackathon:**
- **Prioritaskan unit + integration di jalur kritis** (eskalasi, reminder, anomali, webhook idempotency).
- E2E cukup **1–2 happy path demo** (web + mobile smoke).
- Tidak perlu snapshot test berlebihan, coverage 100%, atau perf test.
- Mock semua pihak ketiga (WA, Google Fit, TTS, Maps) di unit/integration.

## 2. Tooling

| Kebutuhan | Tool |
|---|---|
| Test runner (API, web, shared) | Vitest |
| API integration | Vitest + Supertest + Testcontainers (opsional) / Prisma test DB |
| Component web | Vitest + React Testing Library |
| Mobile (smoke) | Jest + RN Testing Library (opsional; demo manual cukup) |
| E2E web | Playwright |
| Mock HTTP | MSW (server-side & browser) |
| Faker data | @faker-js/faker (data sintetis, berbahasa Indonesia) |
| Queue | InProcessQueue test impl / BullMQ test (real Redis optional) |
| Fake time | `vitest.useFakeTimers()` untuk timeout & scheduler |

## 3. Unit Test

Lokasi: di samping source (`*.test.ts`).

**Cakupan prioritas (backend):**
1. **Anomaly rules** (`modules/vitals/anomaly.rules.test.ts`):
   - HR 145 → `hr>120` (anomalous true)
   - HR 45 → `hr<50` (anomalous true)
   - HR 75 → false
   - Perlu 2 bacaan berurutan dalam 60 dtk → baru trigger (hindari single-spike false positive)
   - Batas per pasien (custom threshold) dihormati
2. **Adherence calculation** (`modules/dashboard/adherence.test.ts`):
   - CONFIRMED/CONFIRMED_LATE/MISSED/PENDING dihitung benar
   - Late window (30 mnt) → `CONFIRMED_LATE`, setelah window → `MISSED`
   - Pembagian dengan nol → 0 (bukan error)
3. **Refill estimator** (`modules/reminders/refill.test.ts`):
   - `estDate = lastRefill + qty / dailyDose`
   - Reminder H-3 → dikirim; setelah `refill_confirmed_at` tidak dikirim lagi
4. **Risk rule engine** (`modules/risk/risk.rules.test.ts`):
   - adherence 7d rendah + streak missed 3 → HIGH
   - tidak ada missed & adherence tinggi → LOW
   - emergency 30d → naikkan level
5. **Template pesan WA** (`modules/notification/templates.test.ts`):
   - Reminder berisi obat/dosis/waktu benar
   - Darurat menyertakan `tel:112` dan maps link (tanpa auto-dial)
   - Tidak ada PII yang tidak perlu (nama vs NIK)
6. **Zod validators** (shared): body invalid → kode error `VALIDATION_ERROR`.
7. **Webhook parser**: `button_reply.id` → intent benar (`CONFIRM_TAKEN_s1`, `SAFE`, `HANDLE`).

## 4. Integration Test (API)

Lokasi: `apps/api/tests/*.integration.test.ts`.

**Setup DB test (CL-003).** Suite integration memakai database **terpisah** dari `DATABASE_URL`, dikonfigurasi lewat `TEST_DATABASE_URL`:

```bash
docker compose -f infra/docker-compose.yml up -d              # postgres 16 + redis 7 (host 6380)
docker exec careloop-postgres createdb -U careloop careloop_test
# apps/api/.env → TEST_DATABASE_URL=postgresql://careloop:careloop@localhost:5432/careloop_test?schema=public
npm run test
```

Helper `apps/api/tests/helpers/test-db.ts`:

| Fungsi | Kegunaan |
|---|---|
| `isTestDbConfigured()` | `describe.skipIf(!isTestDbConfigured())` — suite **dilewati** (bukan gagal) bila `TEST_DATABASE_URL` kosong, sehingga `npm run test` tetap hijau tanpa docker |
| `migrateTestDb()` | `prisma migrate deploy` ke DB test |
| `createTestPrisma()` | PrismaClient yang terikat ke DB test |
| `resetTestDb()` | `TRUNCATE` seluruh tabel domain (setup & teardown) |
| `teardownTestDb()` | disconnect |

`migrateTestDb()`/`createTestPrisma()` **menolak jalan** bila `TEST_DATABASE_URL` sama dengan `DATABASE_URL` — pengaman agar TRUNCATE tidak pernah mengenai DB dev/Supabase.

**Env & Turborepo.** `npm run test` berjalan lewat Turbo, yang hanya meneruskan env
yang terdaftar di `globalEnv` (`turbo.json`). `TEST_DATABASE_URL` dan `REDIS_URL`
harus ada di sana — kalau tidak, suite integration dan test Redis diam-diam ter-skip
dan hasil hijau menyesatkan. Kalau jumlah test skip berubah, cek daftar itu lebih dulu.
`QUEUE_DISABLE_REDIS=1` memaksa test Redis dilewati saat runner memang tidak punya Redis.

**Kasus inti:**
1. **Reminder fire** → job scheduler → `POST /internal/jobs/reminder` → notification WA mock dipanggil dengan benar → `reminder_logs` terisi.
2. **Konfirmasi WA**: webhook dengan signature valid + `button_reply.id=CONFIRM_TAKEN_s1` → compliance log `CONFIRMED`, eskalasi aktif dibatalkan.
3. **Webhook idempotency**: kirim dua kali dengan `message.id` sama → hanya 1 log (`409 ALREADY_PROCESSED` / ignore).
4. **Webhook tanpa signature** → `401`, tidak ada efek samping.
5. **Eskalasi kepatuhan**: jadwal tak dikonfirmasi → waitWindow → Tier 1 dialert → timeout → Tier 2 → timeout → NAKES. (Lihat §6.)
6. **Emergency flow**: `POST /v1/vitals` (anomali) → emergency dibuat → konfirmasi pasien "SAFE" → resolved tanpa alert keluarga; timeout → alert keluarga + nakes + lokasi.
7. **RBAC**: keluarga user A akses pasien B → `403`. Nakes scope puskesmas X akses pasien puskesmas Y → `403`.
8. **Export**: job menghasilkan file CSV tanpa kolom PII (assert tidak ada `nik`, `phone`, nama lengkap).
9. **Refill**: stok → H-3 reminder → confirm → tidak reminder ulang.

## 5. E2E Test

Playwright (web dashboard) — **1–2 skenario demo**:
1. Nakes login → lihat ringkasan → buka alert darurat → klik "Saya Tangani".
2. Nakes filter dashboard (wilayah/penyakit) → grafik berubah.

Mobile: **smoke manual** (Expo Go) — tidak wajib test otomatis. Daftar langkah manual ada di [UI_UX.md](UI_UX.md) §8 checklist demo.

## 6. Test Case Prioritas: Eskalasi Darurat Bertingkat

**Ini adalah jantung produk — harus diuji menyeluruh (unit + integration).**

### 6.1 Unit — state machine (`escalation/stateMachine.test.ts`)
Gunakan fake timers.

| # | Skenario | Input | Expected |
|---|---|---|---|
| ES-1 | Pasien konfirmasi tepat waktu | `onPatientConfirmed` di WAITING_PATIENT | → RESOLVED, job timeout dibatalkan |
| ES-2 | Timeout WAITING_PATIENT, ada family T1 | `onTimeout` | → FAMILY_TIER_1, alert T1 |
| ES-3 | Family T1 handle | `onFamilyHandled` | → HANDLED, tier berikut dibatalkan |
| ES-4 | Timeout T1, ada family T2 | `onTimeout` | → FAMILY_TIER_2 |
| ES-5 | Timeout T2 | `onTimeout` | → NAKES |
| ES-6 | Nakes handle | `onNakesHandled` | → HANDLED |
| ES-7 | Pasien ALONE tanpa T1 | start run | langsung NAKES (skip T1/T2) |
| ES-8 | Pasien punya T2 saja (jauh) | start run | T1 skip → T2 |
| ES-9 | `emergencyPreference=NAKES_FIRST` (darurat) | start | T2 + NAKES paralel |
| ES-10 | Transisi ilegal (run sudah HANDLED) | event apa pun | throw `INVALID_TRANSITION`, tidak ada efek |
| ES-11 | Konfirmasi pasien saat run di T1 | `onPatientConfirmed` | → RESOLVED (bahkan saat eskalasi berjalan) |
| ES-12 | Double active run dicegah | start 2 run context sama | partial unique index → 409 |

### 6.2 Integration — full journey (Fase 2: `tests/fase2-journey.integration.test.ts`)
Telah diimplementasikan pada suite integrasi Fase 2 (CL-214):
1. **Journey Anomali-SAFE -> RESOLVED (AC-4.2)**:
   - Pasien mengonfirmasi `SAFE` melalui `POST /v1/emergencies/:id/respond`.
   - Status darurat diselesaikan (`RESOLVED_SAFE`), eskalasi run diselesaikan (`RESOLVED`).
   - Verifikasi ketat: keluarga **TIDAK** dialert (tidak ada pesan darurat terkirim ke keluarga).
2. **Journey Anomali-Timeout -> Alert Keluarga & Nakes + tel:112 (AC-4.3 s.d. AC-4.6)**:
   - Timeout darurat dipicu melalui `POST /v1/emergencies/:id/timeout`.
   - Untuk pasien bersama keluarga: alert terkirim ke kontak keluarga terurut tier (TIER_1), menyertakan koordinat GPS Google Maps (`AC-4.3`) dan tautan panggilan manual `tel:112` tanpa auto-dial (`AC-4.6`).
   - Untuk pasien tinggal sendiri (ALONE tanpa Tier-1): alert darurat prioritas dikirim langsung ke nakes pembina (`AC-4.5`) beserta tautan `tel:112`.
3. **Urutan Tier Bertingkat & Respons HANDLED Berhenti (AC-7.1 s.d. AC-7.5)**:
   - Pengujian alur berjenjang: respons `LOOKING` mencatat acknowledging tanpa menyelesaikan run.
   - Respons `HANDLE` melalui `POST /v1/escalations/:id/respond` menghentikan eskalasi seketika (`HANDLED`), membatalkan seluruh tier tersisa (`remainingTiersCancelled: true`).
   - Guard transisi ilegal (`AC-7.4`): aksi lanjutan setelah terminal status ditolak dengan kode `422 (INVALID_TRANSITION)`.
4. **Kalkulasi Adherence Dashboard API (AC-5.1, AC-5.3)**:
   - Agregasi `GET /v1/dashboard/summary` memverifikasi rumus `adherenceRate = confirmed / (confirmed + confirmedLate + missed)`.
   - Pengujian keamanan guard pembagian dengan nol (`totalEvaluated = 0 -> adherenceRate = 0`).

**Test timeout restart-safe:**
- Mulai run, simulasikan restart worker (bullmq job dipulihkan dari Redis) → timeout tetap men-trigger transisi. (Skippable bila Redis tak tersedia di test; ganti dengan manual note.)

## 7. Test Case Prioritas: Akurasi Reminder

| # | Skenario | Input | Expected |
|---|---|---|---|
| RM-1 | Schedule aktif, jam sesuai TZ pasien (WIB/WITA/WIT) | cron/bullmq fire | Reminder terkirim pada `timeOfDay` di zona pasien (±2 mnt toleransi) |
| RM-2 | `daysOfWeek` filter benar | schedule Senin-Rabu | Tidak fire hari Kamis |
| RM-3 | Pasien `voice_enabled` | reminder | Pesan teks + audio TTS |
| RM-4 | TTS gagal | mock error | Fallback teks tetap terkirim; `reminder_logs.status=FAILED` untuk TTS |
| RM-5 | WhatsApp down (kirim gagal) | mock `SEND_FAILED` | Retry ≤ 3, log error, tidak double-send (idempoten) |
| RM-6 | Konfirmasi "Tunda 15 menit" | `DEFER` reply | Reminder baru +15 mnt; tidak langsung eskalasi |
| RM-7 | Jendela 30 mnt (timeWindow) | konfirmasi menit ke-35 | `CONFIRMED_LATE` (bukan MISSED) |
| RM-8 | Konfirmasi di luar 24 jam | 1 hari kemudian | Tidak dicatat (guard), atau `notes` khusus |

## 8. Test Case: Deteksi Anomali

| # | Skenario | Input | Expected |
|---|---|---|---|
| AN-1 | HR 145, 2 bacaan 30 dtk | vital events | anomaly `hr>120`; emergency dibuat |
| AN-2 | HR 145 sekali saja (spike) | 1 event | Belum emergency (butuh ≥ 2) |
| AN-3 | HR 45 | 2 bacaan | anomaly `hr<50` |
| AN-4 | HR dalam batas | 2 bacaan | no anomaly |
| AN-5 | Pasien matikan smartwatch | event masuk | ditolak / di-log, tidak trigger |
| AN-6 | Duplikat event (recordedAt+source sama) | dua kali | idempoten, 1 log |
| AN-7 | Custom threshold pasien (misal >130) | HR 125 | tidak anomaly |

## 9. Test Data & Fixture

- `prisma/personas.ts`: satu sumber persona sintetis (`DEMO_IDS`, `DEMO_PHONES`, `seedDemoPersonas()`) yang dipakai **bersama** oleh seed demo dan fixture test — Bu Ratna (ALONE, NAKES_FIRST, family T2 + kader primary) dan Pak Haji (WITH_FAMILY, family T1), obat & jadwal masing-masing.
- `prisma/seed.ts` hanya membungkus `seedDemoPersonas()`; upsert sehingga idempoten.
- Semua id memakai uuid v4 statis berpola `00000000-0000-4000-8000-…` agar lolos validator `z.string().uuid()` dan jelas sintetis. Nomor HP fiktif berpola (`0811/0812/0813` + blok nol) — **tidak ada nama/NIK/HP riil**.
- Setiap suite integration memakai DB test bersih + `beforeAll` migrate/seed.
- Token test: helper membuat JWT untuk role/scope tertentu.

## 10. Integrasi Pihak Ketiga: WhatsApp API

**Strategi: selalu mock di test; sandbox hanya untuk manual/smoke.**

| Tahap | Detail |
|---|---|
| **Mock (default)** | `WhatsAppService` interface → `MockWhatsAppProvider` (Vitest) mencatat calls; assert payload (template, button ids, `tel:112`). |
| **Contract test** | Pastikan objek yang dikirim sesuai schema provider (body Meta): `to`, `type: interactive`, `interactive.button_reply.id` format `CONFIRM_TAKEN_<id>`. Simpan golden JSON fixture. |
| **Webhook test** | MSW me-reply payload Meta sungguhan → assert parse + idempotency + 200 cepat. |
| **Sandbox manual (CI/lokal)** | Menuangkan 1 reminder + 1 darurat ke sandbox number untuk verifikasi visual (tidak otomatis). |
| **Fallback provider** | Unit test switch ke Twilio provider → output schema berbeda tapi behavior sama (abstraksi bekerja). |

**Risiko test**: Meta bisa ubah schema → pin fixture dengan tanggal; jika perubahan, update contract test.

## 11. Integrasi Pihak Ketiga: Smartwatch API

| Tahap | Detail |
|---|---|
| **Adapter mock (default)** | `SmartwatchAdapter` interface → `MockSmartwatchProvider` menghasilkan stream sintetis + endpoint `/v1/dev/mock-anomaly` (hanya `NODE_ENV !== 'production'`). |
| **Contract test Google Fit** | Mock HTTP (MSW) untuk `v1.users.sessions`/data sources → assert parsing HR benar, auth service account benar. |
| **Error handling** | API 401/429/503 → adapter mengembalikan `unavailable` → sistem tidak crash; antrian ingest tetap jalan. |
| **HealthKit (iOS)** | Manual smoke di simulator (plugin Expo) — hanya jika waktu memungkinkan. |
| **Idempotency ingest** | Event `recordedAt+source` duplikat → satu baris vital (AN-6). |

## 12. Testing di CI

GitHub Actions (`.github/workflows/ci.yml`):

```
- setup node 20
- npm ci
- lint
- typecheck
- unit: vitest run --coverage (threshold: garis 70% untuk modules/escalation, reminders, vitals, risk)
- integration: docker compose up postgres redis → createdb careloop_test → TEST_DATABASE_URL=... vitest run
- web e2e: Playwright (2 skenario demo)
```

- Artifacts: coverage report, Playwright report.
- Jalur kritis (escalation/vitals/reminders) wajib ≥ 70% line coverage — sisanya best effort.

## 13. Definisi Selesai (Testing)

Per feature/P0 sebelum dianggap selesai:
- [ ] Unit test untuk aturan bisnis (anomaly, adherence, eskalasi state, refill, risk).
- [ ] Integration test happy path + minimal 1 edge (timeout/duplikat/RBAC).
- [ ] `npm run test` hijau; lint & typecheck hijau.
- [ ] Fixture data sintetis (tanpa data riil).
- [ ] Skenario demo (1–2 E2E web + manual mobile) tercatat di README/section demo.

**Metrik sukses testing demo:**
- Jalur darurat bertingkat lolos ES-1 s/d ES-12 + 1 journey integration penuh.
- Reminder: RM-1, RM-2, RM-6, RM-7 lolos.
- Webhook idempotency & signature lolos.
