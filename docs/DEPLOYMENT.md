# Deployment — Supabase + Cloud Runbook

Runbook operasional CareLoop: dari database lokal ke Supabase PostgreSQL, Redis
hosted, lalu API di platform container. Rencana induk ada di
[tasks/plan-supabase-deployment.md](../tasks/plan-supabase-deployment.md); dokumen
ini adalah hasil eksekusi + prosedur yang harus diikuti setiap cutover.

Prinsip: **tidak ada migration dari request API**. Schema_changed di luar aplikasi,
dan `migrate deploy` hanya jalan sebagai release step.

---

## 1. Topologi

```text
Web Next.js ───────┐
                   ├── HTTPS ──→ Fastify API ──→ Prisma ──→ Supabase PostgreSQL
Mobile Expo ──────┘                    │
                                        ├──→ Redis hosted (BullMQ + OTP store)
                                        ├──→ WhatsApp provider / mock
                                        └──→ WebSocket dashboard (Socket.IO)
```

- Supabase = managed PostgreSQL. Web dan mobile **tidak pernah** menyentuh database.
- Prisma tetap data access layer; JWT, OTP, RBAC, audit, clinical gate, dan state
  machine tetap di backend.
- Supabase Auth & Supabase Realtime tidak dipakai pada fase ini.

## 2. Ringkasan environment

| | local | staging | production/demo |
|---|---|---|---|
| Database | PostgreSQL Docker (`infra/docker-compose.yml`) | Supabase project staging | Supabase project terpisah |
| Redis | Redis Docker (host port 6380) | Redis hosted staging | Redis hosted production |
| API | `npm run dev:api` | container | container |
| Web | `npm run dev:web` | build dengan `NEXT_PUBLIC_API_URL` staging | build dengan URL production |

Aturan yang tidak boleh dilanggar:

- `TEST_DATABASE_URL` **wajib** berbeda dari `DATABASE_URL` — integration test melakukan
  `TRUNCATE`. Validasi ini sudah ditegakkan `apps/api/src/lib/env.ts`.
- Password database berbeda per environment.
- Secret hanya di secret manager platform. `.env*` tidak pernah masuk git
  (`.gitignore` sekarang menolak semua `.env*` kecuali `.env.example`).
- `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` hanya boleh ada di backend/worker —
  jangan pernah di `NEXT_PUBLIC_*` atau `EXPO_PUBLIC_*`.

## 3. Fase 1 — Hasil audit kompatibilitas

| Area | Temuan | Mitigasi |
|---|---|---|
| Provider Prisma | `postgresql`, tanpa extension & tanpa fitur preview | Tidak perlu perubahan untuk Supabase |
| Direct URL | `datasource` hanya punya `url`; `DIRECT_URL` ada di env tapi tak terpakai | `directUrl = env("DIRECT_URL")` ditambahkan — migration kini dijamin lewat koneksi non-pooler |
| Raw SQL | Hanya di `tests/helpers/test-db.ts` (truncate test) | Tidak ada prepared statement di path produksi, jadi transaction pooler aman |
| Query & transaksi | Semua lewat Prisma client/repository; tidak ada koneksi `pg` langsung | Tidak ada bind parameter manual yang bisa rusak di PgBouncer |
| Koneksi jangka panjang | Scheduler (reminder, eskalasi, farmasi) berjalan in-process memakai Prisma singleton | Pakai pooler dengan `connection_limit` konservatif; scheduler tetap query per tick, bukan connection yang dipegang |
| Queue | `BullMqQueue` (Redis) atau `InProcessQueue` (demo). `REDIS_URL` kosong → in-process | `NODE_ENV=production` kini **menolak startup tanpa `REDIS_URL`** — tidak ada lagi fallback diam-diam yang hilang saat restart |
| Logging | Tidak ada penulisan password/token/connection string/NIK. `lib/audit.ts` punya pola redaksi | Error 5xx dinormalisasi tanpa stack trace (`lib/errors.ts`) |
| Error response | 5xx hanya `{ code, message }` generik | Tidak ada kebocoran internal ke klien |
| OTP | Sebelumnya `InMemoryOtpStore` saja | Diganti `RedisOtpStore` persisten, lihat §7 |

Risiko tersisa dan penanganannya:

- **Prepared statement vs PgBouncer**: pakai transaction mode (port 6543) hanya untuk
  `DATABASE_URL`; `DIRECT_URL` selalu port 5432.
- **Connection exhaustion**: Batasi `connection_limit` (disarankan 5–10 per replica)
  dan pastikan jumlah replica tidak melebihi kuota Supabase.
- **Redis mati**: `/readyz` melaporkan `503`, job tertahan di antrean, tidak hilang.

## 4. Fase 2 — Konfigurasi environment

Buat project Supabase staging lebih dulu; project production/demo terpisah dibuat
hanya saat staging sudah stabil (lihat §11).

Variabel backend (nilai rahasia hanya di secret manager):

```env
NODE_ENV=production
PORT=4000

# Runtime API — boleh pooler (transaction mode) untuk menghemat koneksi.
DATABASE_URL=postgresql://USER:PASSWORD@db.<ref>.supabase.co:6543/postgres?pgbouncer=true&connection_limit=5
# Migrasi/schema deploy — WAJIB koneksi direct, tanpa parameter pooler.
DIRECT_URL=postgresql://USER:PASSWORD@db.<ref>.supabase.co:5432/postgres

# Database integration test, selalu terpisah.
TEST_DATABASE_URL=

# BullMQ + OTP store. Pakai `rediss://` bila provider mendukung TLS.
REDIS_URL=rediss://USER:PASSWORD@<host>:6379

JWT_SECRET=<random minimal 32 karakter>
JWT_EXPIRES_IN=24h
DATA_ENCRYPTION_KEY=

PROVIDER_MODE=mock
CORS_ORIGINS=https://<web-domain>
```

Production **menolak startup** (`EnvValidationError`) bila `CORS_ORIGINS`, `REDIS_URL`,
atau `DIRECT_URL` kosong — itu memang gate yang disengaja.

Frontend:

```env
# apps/web
NEXT_PUBLIC_API_URL=https://<api-domain>
# apps/mobile
EXPO_PUBLIC_API_URL=https://<api-domain>
```

`apps/web` dan `apps/mobile` sekarang **menolak** build production tanpa variabel
tersebut (tidak ada lagi fallback diam-diam ke `localhost`). Lihat `apps/web/.env.example`.

## 5. Fase 3 — Prisma & migration

Perintah yang dipakai semua platform:

```bash
# build image
npm ci --ignore-scripts
npx prisma generate --schema apps/api/prisma/schema.prisma
npm run build -w @careloop/api

# release step (sebelum container menerima traffic)
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# start
node apps/api/dist/index.js
```

Urutan staging dari database kosong:

```text
Supabase kosong
  → set secret backend
  → prisma migrate deploy
  → seed sintetis
  → /readyz
  → smoke test API
```

Verifikasi setelah `migrate deploy`:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
```

`GET /readyz` juga mengembalikan nama migration terakhir yang terpasang, jadi versi
schema bisa diawasi tanpa akses SQL.

Aturan kepemilikan proses migration:

- Migration dijalankan **satu orang/satu pipeline** (release step), tidak paralel.
- Kalau migration gagal di tengah, `prisma migrate deploy` berikutnya akan berhenti
  dan memberi pesan; **jangan** `migrate reset` di production. Lihat §10.

## 6. Fase 4 — Seed dan data demo

- Struktur database selalu dari migration, **tidak pernah** menyalin dump database lokal.
- `npm run db:seed -w @careloop/api` hanya menghasilkan data sintetis
  (`apps/api/prisma/personas.ts`): nama fiktif, NIK & nomor HP dummy, tanpa lokasi riil.
- Seed bersifat idempoten — menjalankannya dua kali tidak menggandakan data.
- Reset staging yang aman (tidak menyentuh production):

```bash
# hanya untuk project staging, database sudah di-backup dulu
npx prisma migrate reset --force --schema apps/api/prisma/schema.prisma
npm run db:seed -w @careloop/api
```

## 7. Fase 5 & 6 — Redis, BullMQ, dan OTP

Redis dibutuhkan untuk reminder, timeout eskalasi, retry pengiriman, emergency job,
dedup, dan penyimpanan OTP. Pilih provider yang mendukung TLS (`rediss://`) dan buat
instance terpisah untuk staging dan production.

Implementasi OTP (CL-401):

- `apps/api/src/modules/auth/otp.store.ts`
  - `InMemoryOtpStore` — development & unit test.
  - `RedisOtpStore` — produksi. TTL key mengikuti sisa masa berlaku challenge,
    jadi kode basi dibersihkan Redis sendiri.
  - `consumeAttempt()` dan `consume()` dijalankan sebagai skrip Lua → atomik lintas
    replica: dua verifikasi paralel tidak bisa memakai jatah percobaan yang sama,
    dan kode yang sama hanya bisa dipakai sekali.
  - Kode OTP tidak pernah ditulis ke log.
  - `createOtpStore()` memilih Redis otomatis saat `REDIS_URL` terisi;
    `NODE_ENV=test` dikunci ke memory supaya test deterministik.

Saat Redis tidak terjangkau, endpoint OTP mengembalikan error 500 yang generik
(bukan "berhasil") dan `/readyz` jadi `503`.

## 8. Fase 7 — Deploy API

`Dockerfile` di root adalah image produksi (multi-stage, user `node`, tanpa secret).
Kontraknya:

| Item | Nilai |
|---|---|
| Health check (liveness) | `GET /healthz` |
| Readiness check | `GET /readyz` → `200` / `503` |
| Release step | `npx prisma migrate deploy` |
| Start | `node apps/api/dist/index.js` |
| Shutdown | `SIGTERM` → drain WebSocket, BullMQ, Redis, Prisma (batas 15 detik) |

Checklist sebelum merge ke production:

- `PORT` mengikuti platform (tidak dipatok 4000 di container).
- `CORS_ORIGINS` berisi origin web yang valid.
- Satu instance API + worker. Scheduler reminder/eskalasi/farmasi berjalan di dalam
  proses yang sama (`src/index.ts`), jadi **jangan** menjalankan dua replica aktif
  bersamaan tanpa Redis adapter untuk Socket.IO — eskalasi bisa terkirim ganda.
- WebSocket reconnect otomatis di sisi web; setelah deploy,Putuskan load balancer
  dengan graceful shutdown (bukan kill -9).

## 9. Fase 8 — Web & mobile

- Web: set `NEXT_PUBLIC_API_URL` di build environment, lalu `npm run build -w @careloop/web`.
- Mobile: set `EXPO_PUBLIC_API_URL` saat build EAS. Deep link dan WebSocket memakai
  base URL yang sama — tidak ada konfigurasi kedua.
- Verifikasi: dashboard nakes login, data sesuai scope; OTP pasien; token dipakai di
  seluruh endpoint pasien; perangkat fisik tidak menyentuh `localhost`.
- Bundle frontend tidak boleh memuat secret maupun URL database.

## 10. Fase 10 — Observability, backup, recovery

- Log memakai `x-request-id` per request. Audit log actor/resource tetap di
  `lib/audit.ts` dengan redaksi field sensitif.
- Pantau `/healthz` (restart policy) dan `/readyz` (load balancer + alert).
- Backup: aktifkan backup/PITR di project Supabase sesuai environment
  (staging boleh harian, production perlu PITR).
- Restore ke staging untuk latihan:

```bash
# dump dari project sumber (SUPABASE_URL hanya di shell, jangan di-commit)
pg_dump "$SOURCE_DATABASE_URL" --format=custom --file backup.dump
pg_restore --dbname "$STAGING_DIRECT_URL" --clean --if-exists backup.dump
```

- Rollback aplikasi **tidak** lewat `migrate reset`. Urutan yang aman:
  1. Deploy versi aplikasi lama (schema additive tetap kompatibel).
  2. Kalau migration damaging, siapkan migration balik (forward fix) lebih dulu.
  3. `migrate deploy` hanya dijalankan dari pipeline, satu pemilik.
- Cutover balik ke database lama bila Supabase bermasalah: kembalikan `DATABASE_URL`
  dan `DIRECT_URL` ke nilai sebelum cutover, deploy ulang, lalu replay event yang
  terlewat lewat `event_id` (semua handler webhook & jobqueue idempoten).

Skenario wajib diuji sebelum production (lihat §11):

| Skenario | Ekspektasi |
|---|---|
| API restart | Tidak ada data hilang; scheduler lanjut |
| Worker/proses restart | Reminder & eskalasi tidak terkirim ganda |
| Redis mati | `/readyz` 503, job tertahan di antrean, tidak hilang |
| Connection pool habis | 5xx terisolasi per request, proses tetap sehat |
| Job timeout saat proses mati | Job dieksekusi ulang setelah proses hidup |

## 11. Fase 11 — Checklist verifikasi

- [ ] `npm run typecheck`, `npm run lint`, `npm run test` lulus.
- [ ] Integration test memakai `TEST_DATABASE_URL` yang terpisah.
- [ ] `prisma migrate deploy` berhasil dari database Supabase kosong.
- [ ] `_prisma_migrations` terisi dan `/readyz` melaporkan versi migration.
- [ ] Seed hanya memakai data sintetis.
- [ ] Login admin & nakes berhasil; scope puskesmas berlaku.
- [ ] OTP pasien berhasil melalui Redis (`RedisOtpStore` aktif, bukan memory).
- [ ] Resep draft/approved dan jadwal sesuai clinical gate.
- [ ] Reminder hanya untuk pasien `ACTIVE`.
- [ ] Compliance & escalation idempoten setelah restart.
- [ ] Emergency & WebSocket berfungsi; dashboard menampilkan alert real-time.
- [ ] Apotek (`FARMASI`) tetap tidak bisa mengakses data di luar minimization.
- [ ] Web/mobile memakai HTTPS API publik.
- [ ] Tidak ada secret di git diff maupun bundle frontend.
- [ ] Tidak ada auto-dial 112 (tombol one-tap call saja).

## 12. Fase 12 — Cutover

```text
 1. Freeze schema dan backup sumber
 2. Buat Supabase staging
 3. Jalankan migration
 4. Seed sintetis
 5. Deploy API + worker staging
 6. Hubungkan web/mobile staging
 7. Smoke test + demo journey
 8. Perbaiki temuan di staging
 9. Buat Supabase production/demo terpisah
10. Jalankan migration production
11. Seed hanya bila environment demo
12. Deploy API/worker production
13. Update URL web/mobile
14. Pantau health check, queue, log, dan alert
```

Rollback cepat: kembalikan URL API web/mobile ke staging, matikan scheduler di
production (env `REDIS_URL` kosong sudah dijegal saat startup — hentikan service, jangan
mengubah env di tengah jalan), lalu investigasi di staging.

## 13. Hasil verifikasi terhadap Supabase (2026-10-15)

Project yang dipakai: `<project-ref>` (region ap-southeast-1). Ref project tidak ditulis di
repo publik; ambil nilainya dari dashboard Supabase.

Hasil pemeriksaan:

| Yang dicek | Hasil |
|---|---|
| `_prisma_migrations` | 6 migration, semuanya `finished_at` terisi |
| Objek database | 28 tabel, 36 enum, 83 index, 48 foreign key |
| Data | 8 user + 2 pasien sintetis (hasil seed) |
| `/healthz` | 200 |
| `/readyz` | 200 — `database: ok`, `migrations: ok`, `redis: ok`, `queue: bullmq`, migration `20261013012414_staff_lifecycle_and_puskesma_crud` |
| `POST /v1/auth/login` (nakes) | 200, token valid |
| `GET /v1/dashboard/summary` | 200, membaca data dari Supabase |
| `POST /v1/auth/otp/request` + `verify` | 200 via `RedisOtpStore`, key `careloop:otp:*` ber-TTL ~300 detik |
| Endpoint tanpa token | 401 |

Dua hal yang **wajib** benar saat menyalin kredensial ini ke environment lain:

- **User berbeda antara pooler dan direct.** `DATABASE_URL` memakai
   `postgres.<ref>@aws-0-ap-<region>.pooler.supabase.com:5432`, sedangkan `DIRECT_URL`
   memakai `postgres@db.<ref>.supabase.co:5432`. Mengganti `DIRECT_URL` dengan URL pooler +
   user `postgres.<ref>` berakhir `P1000: Authentication failed` — persis seperti
   yang terjadi saat konfigurasi awal dicoba.
- **Test database tetap lokal.** `TEST_DATABASE_URL` tidak boleh diarahkan ke Supabase;
   integration test melakukan `TRUNCATE`.

Belum diverifikasi pada sesi ini: scope puskesmas, resep draft/approved, reminder hanya
untuk pasien `ACTIVE`, idempotensi setelah restart worker, WebSocket, dan deployment
web/mobile ke domain publik.

## 14. Batas fase ini (tidak dikerjakan)

- Tidak memindahkan auth custom ke Supabase Auth.
- Tidak mengganti Prisma dengan Supabase SDK (tidak ada dependensi `@supabase/supabase-js`).
- Tidak mengganti WebSocket dengan Supabase Realtime.
- Tidak memindahkan file ke Supabase Storage (belum ada kebutuhan upload).
- Tidak menggabungkan database test dengan database demo/production.