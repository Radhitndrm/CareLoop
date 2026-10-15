# Plan — Persiapan Supabase & Deployment Cloud

> **Status:** fase kode (1, 3, 5, 6, 7, 8) sudah dieksekusi di repo. Item yang
> tersisa butuh kredensial & platform nyata (buat project Supabase, pilih Redis
> hosted, jalankan deploy). Prosedur, hasil audit, dan runbook ada di
> [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). Kotak `[x]` berarti sudah selesai di
> repo, bukan berarti sudah dideploy ke cloud.

## Tujuan

Memindahkan database bersama CareLoop dari PostgreSQL lokal ke Supabase PostgreSQL dan menyiapkan deployment cloud tanpa merombak business logic, Prisma, RBAC, atau service backend.

## Keputusan arsitektur

```text
Web Next.js ───────┐
                   ├── HTTPS ──→ Fastify API ──→ Prisma ──→ Supabase PostgreSQL
Mobile Expo ──────┘                    │
                                       ├──→ Redis/BullMQ hosted
                                       ├──→ WhatsApp provider/mock
                                       └──→ WebSocket dashboard
```

- Supabase digunakan sebagai managed PostgreSQL.
- Web dan mobile tidak mengakses database secara langsung.
- Semua operasi data melewati Fastify API.
- Prisma tetap menjadi data access layer.
- JWT, OTP, RBAC, audit, clinical gate, dan state machine tetap di backend.
- Supabase Auth dan Supabase Realtime tidak dimigrasikan pada fase awal.
- Jangan menambahkan `@supabase/supabase-js` tanpa kebutuhan yang disetujui.

## Kondisi baseline

Yang sudah kompatibel:

- Prisma menggunakan provider PostgreSQL.
- Backend membaca database melalui `DATABASE_URL`.
- Tersedia `DIRECT_URL` untuk koneksi migration.
- Web menggunakan `NEXT_PUBLIC_API_URL`.
- Mobile menggunakan `EXPO_PUBLIC_API_URL`.
- Redis/BullMQ sudah menjadi bagian arsitektur queue.

Gap yang harus diselesaikan:

- environment masih mengarah ke PostgreSQL lokal;
- belum ada Supabase staging/production;
- belum ada migration dan smoke test cloud;
- API belum dipastikan memiliki deployment publik;
- Redis production belum disiapkan;
- OTP masih menggunakan `InMemoryOtpStore`;
- belum ada prosedur backup, recovery, dan rollback;
- web/mobile masih memiliki fallback `localhost`.

## Fase 1 — Audit kompatibilitas

- [x] Inventaris seluruh model, enum, index, constraint, foreign key, transaction, dan extension Prisma.
- [ ] Pastikan semua migration dapat dijalankan dari database PostgreSQL kosong.
- [x] Jalankan `prisma validate`.
- [x] Jalankan `prisma generate`.
- [x] Identifikasi query yang sensitif terhadap connection pooling atau prepared statement.
- [x] Identifikasi worker yang memiliki koneksi database jangka panjang.
- [x] Pastikan seluruh service memakai Prisma/repository, bukan koneksi database langsung.
- [x] Pastikan log tidak mencatat password, token, connection string, NIK, atau data klinis sensitif.
- [x] Pastikan fitur yang membutuhkan Redis tidak diam-diam dianggap berhasil ketika Redis mati.

**Output:** daftar kompatibilitas, risiko, dan tindakan mitigasi.

## Fase 2 — Pisahkan environment

Target minimal:

```text
local      → PostgreSQL Docker + Redis Docker
staging    → Supabase staging + Redis hosted staging
production → Supabase production/demo + Redis hosted production
```

- [ ] Buat project Supabase staging.
- [ ] Buat project production/demo terpisah jika demo akan dipakai berulang.
- [ ] Gunakan password database berbeda per environment.
- [ ] Simpan secret di secret manager platform deployment.
- [x] Jangan memasukkan `.env` ke git, issue, screenshot, atau dokumentasi publik.
- [x] Dokumentasikan nama variable tanpa nilai rahasia.
- [x] Pastikan database test selalu terpisah dari staging dan production.

Variable backend:

```env
NODE_ENV=production
DATABASE_URL=<supabase-pooled-connection>
DIRECT_URL=<supabase-direct-connection>
TEST_DATABASE_URL=<separate-test-database>
REDIS_URL=<hosted-redis-url>
JWT_SECRET=<random-secret-at-least-32-characters>
DATA_ENCRYPTION_KEY=<encryption-key-if-enabled>
CORS_ORIGINS=<web-allowed-origin>
```

Aturan:

- `DATABASE_URL` digunakan runtime API.
- `DIRECT_URL` digunakan migration/deploy schema.
- `TEST_DATABASE_URL` tidak boleh sama dengan database yang menjalankan data demo.
- `DATABASE_URL`, `DIRECT_URL`, dan `REDIS_URL` hanya boleh berada di backend/worker.
- URL database tidak boleh masuk ke `NEXT_PUBLIC_*` atau `EXPO_PUBLIC_*`.

## Fase 3 — Konfigurasi Prisma dan migration

- [x] Pastikan `datasource` tetap menggunakan `provider = "postgresql"`.
- [x] Pastikan migration menggunakan koneksi direct melalui `DIRECT_URL` sesuai konfigurasi Prisma.
- [ ] Buat Supabase database kosong untuk staging.
- [ ] Jalankan `prisma migrate deploy`.
- [ ] Periksa tabel dan `_prisma_migrations`.
- [ ] Periksa enum, index, unique constraint, dan foreign key.
- [x] Pastikan migration dijalankan sebagai release/CI step, bukan dari request API.
- [ ] Tetapkan pemilik proses migration agar tidak dijalankan bersamaan oleh beberapa orang.

Urutan staging:

```text
Supabase kosong
  → set secret backend
  → prisma migrate deploy
  → seed sintetis
  → health check
  → smoke test API
```

## Fase 4 — Seed dan data demo

- [x] Jangan menyalin database lokal mentah ke Supabase.
- [x] Gunakan migration untuk struktur database.
- [x] Gunakan seed sintetis untuk data demo.
- [x] Pastikan tidak ada pasien riil, NIK riil, nomor HP riil, atau lokasi riil.
- [ ] Buat password akun demo khusus staging/demo.
- [x] Jangan menggunakan password production di seed.
- [x] Pastikan seed dapat diulang atau memiliki prosedur reset staging yang jelas.
- [x] Dokumentasikan cara membersihkan staging tanpa menyentuh production.

## Fase 5 — Redis/BullMQ hosted

Supabase tidak menggantikan Redis. Redis tetap dibutuhkan untuk:

- reminder;
- timeout eskalasi;
- retry pengiriman;
- emergency job;
- rate limit/dedup;
- OTP setelah dipindahkan dari memory.

- [ ] Pilih Redis hosted yang mendukung TLS.
- [ ] Buat Redis staging dan production/demo terpisah.
- [ ] Set `REDIS_URL` hanya pada API/worker.
- [ ] Verifikasi queue dan worker dapat terhubung.
- [ ] Verifikasi retry dan backoff.
- [ ] Verifikasi job idempotency setelah worker restart.
- [x] Tambahkan health check Redis tanpa membocorkan credential.
- [ ] Uji Redis unavailable dan pastikan sistem mengembalikan error jelas.

## Fase 6 — Pindahkan OTP dari memory

Saat ini OTP masih memakai `InMemoryOtpStore`, sehingga tidak cocok untuk restart atau multi-instance.

- [x] Buat interface OTP store yang dapat diimplementasikan dengan Redis.
- [x] Implementasikan Redis OTP store dengan TTL.
- [x] Simpan attempt count dan cooldown secara atomik.
- [x] Jangan mencatat OTP di log.
- [x] Pertahankan response anti-enumeration.
- [x] Test expiry, cooldown, max attempts, retry, dan restart.
- [x] Izinkan fallback memory hanya untuk development/mock.
- [x] Pastikan production/cloud selalu memakai store persisten.

## Fase 7 — Deploy Fastify API dan worker

- [x] Pilih platform yang mendukung Node.js 20+, HTTPS, environment secret, dan WebSocket.
- [ ] Deploy API Fastify.
- [ ] Jalankan `prisma migrate deploy` sebelum API menerima traffic.
- [ ] Jalankan reminder/escalation worker sebagai proses terpisah atau managed worker.
- [x] Gunakan `PORT` dari environment platform.
- [ ] Isi `CORS_ORIGINS` dengan origin web yang valid.
- [x] Tambahkan health/readiness check untuk:
  - API (`/healthz` liveness, `/readyz` readiness);
  - database (`SELECT 1` + versi migration terakhir);
  - Redis (PING, tanpa credential di respons);
  - migration version (nama migration terakhir di `_prisma_migrations`);
  - worker/queue (mode queue dilaporkan di `/readyz`).
- [x] Pastikan error response tidak membocorkan stack trace atau connection string.
- [ ] Pastikan request ID dan log actor/resource aman.
- [ ] Pastikan WebSocket dapat connect dan reconnect setelah restart.

## Fase 8 — Hubungkan web dan mobile

- [ ] Set `NEXT_PUBLIC_API_URL=https://<api-domain>`.
- [ ] Set `EXPO_PUBLIC_API_URL=https://<api-domain>`.
- [x] Jangan memasukkan URL Supabase database ke frontend.
- [ ] Verifikasi web dapat login admin/nakes.
- [ ] Verifikasi web hanya melihat data sesuai scope.
- [ ] Verifikasi mobile dapat login OTP.
- [ ] Verifikasi token mobile digunakan pada seluruh endpoint pasien.
- [ ] Verifikasi perangkat fisik tidak memakai `localhost:4000`.
- [ ] Verifikasi deep link memakai API base URL yang benar.
- [ ] Verifikasi WebSocket dashboard memakai domain production/staging.
- [ ] Pastikan build production tidak membawa secret atau URL environment yang salah.

## Fase 9 — Security Supabase dan API

- [ ] Simpan password database, JWT secret, WhatsApp secret, dan Redis credential di secret manager.
- [ ] Gunakan koneksi TLS.
- [ ] Batasi akses database ke backend/worker.
- [ ] Jangan mengandalkan browser/mobile untuk authorization.
- [ ] Jangan mengandalkan RLS Supabase sebagai pengganti RBAC API pada migrasi awal.
- [ ] Pertahankan scope puskesmas dan clinical gate di backend.
- [ ] Pertahankan minimisasi data untuk farmasi.
- [ ] Aktifkan backup/PITR sesuai kebutuhan environment.
- [ ] Audit siapa yang memiliki akses ke project Supabase.
- [ ] Tentukan retention dan penghapusan data demo.

## Fase 10 — Observability, backup, dan recovery

- [ ] Tambahkan log koneksi gagal tanpa secret.
- [ ] Tambahkan metric/health check database, Redis, queue, dan worker.
- [ ] Uji restart API tanpa kehilangan data.
- [ ] Uji restart worker tanpa duplikasi reminder/escalation.
- [ ] Uji connection pool exhaustion.
- [ ] Uji timeout job ketika worker mati lalu hidup kembali.
- [ ] Dokumentasikan backup dan restore ke staging.
- [ ] Dokumentasikan rollback aplikasi tanpa `migrate reset` production.
- [ ] Dokumentasikan prosedur cutover kembali jika Supabase bermasalah.

## Fase 11 — Verification checklist

- [x] `npm run typecheck` lulus.
- [x] `npm run lint` lulus.
- [x] Unit test lulus (794 lulus, 0 skip setelah Redis aktif).
- [x] Integration test menggunakan `TEST_DATABASE_URL` terpisah (PostgreSQL lokal, bukan Supabase).
- [x] Migration berhasil dari database Supabase kosong (6 migration OK, 28 tabel, 36 enum, 83 index, 48 FK).
- [x] Seed hanya menggunakan data sintetis (8 user, 2 pasien fiktif di Supabase).
- [x] Login nakes berhasil lewat API publik ke Supabase. Login admin belum diuji manual.
- [x] OTP pasien berhasil melalui Redis (`RedisOtpStore`, key `careloop:otp:*` dengan TTL ~300 detik).
- [ ] Scope puskesmas berhasil.
- [ ] Resep draft/approved dan jadwal berhasil.
- [ ] Reminder hanya dikirim untuk pasien `ACTIVE`.
- [ ] Compliance dan escalation idempoten setelah worker restart.
- [ ] Emergency dan WebSocket berhasil.
- [ ] Farmasi tidak dapat mengakses data yang tidak diperlukan.
- [ ] Web/mobile menggunakan HTTPS API publik.
- [ ] Tidak ada secret di git diff atau frontend bundle.
- [ ] Tidak ada auto-dial 112.

## Fase 12 — Cutover

```text
1. Freeze schema dan backup sumber
2. Buat Supabase staging
3. Jalankan migration
4. Seed sintetis
5. Deploy API dan worker staging
6. Hubungkan web/mobile staging
7. Jalankan smoke test dan demo journey
8. Perbaiki temuan di staging
9. Buat Supabase production/demo terpisah
10. Jalankan migration production
11. Seed hanya bila environment demo
12. Deploy API/worker production
13. Update URL web/mobile
14. Pantau health check, queue, log, dan alert
```

## Scope yang tidak dikerjakan pada migrasi awal

- [ ] Tidak memindahkan auth custom ke Supabase Auth.
- [ ] Tidak mengganti Prisma service dengan Supabase SDK.
- [ ] Tidak mengganti WebSocket dengan Supabase Realtime.
- [ ] Tidak memindahkan file ke Supabase Storage sebelum ada kebutuhan upload.
- [ ] Tidak menggabungkan database test dengan database demo/production.

## Definition of done

- API staging berhasil membaca dan menulis data di Supabase melalui Prisma.
- Web dan mobile hanya berkomunikasi dengan API publik.
- Migration dan seed sintetis dapat dijalankan pada environment baru.
- Redis/BullMQ berjalan dan restart-safe.
- OTP tidak lagi bergantung pada memory di cloud.
- Smoke test flow kritis lulus.
- Tidak ada secret di repository atau frontend bundle.
- Dokumentasi deployment, backup, recovery, dan rollback tersedia.
