# Fase 1 — Fondasi & Loop Kepatuhan (Minggu 1)

> Fitur PRD: **1 (Reminder WA)**, **2 (Konfirmasi 1-tap)**, **3 (Auto-eskalasi keluarga)** + fondasi teknis.
> Target: alur `reminder → konfirmasi → eskalasi keluarga` berfungsi end-to-end.
> Referensi: [PRD §6 FR-1..FR-3](../docs/PRD.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [DATABASE](../docs/DATABASE.md), [API](../docs/API.md), [SECURITY](../docs/SECURITY.md).

## 1.1 Infra & Database

- [ ] Jalankan `docker compose -f infra/docker-compose.yml up -d` dan pastikan postgres + redis sehat.
- [ ] Buat migrasi pertama: `npm run db:migrate` (nama `init`). Verifikasi skema sesuai [docs/DATABASE.md](../docs/DATABASE.md).
- [ ] Jalankan `npm run db:seed` dan pastikan Bu Ratna & Pak Haji masuk (cek via Prisma Studio / query).
- [ ] Konfigurasi env lengkap di `apps/api/.env` sesuai `.env.example` (DATABASE_URL, REDIS_URL, JWT_SECRET, TZ_OFFSET, placeholder WhatsApp).

## 1.2 Auth & Keamanan Dasar

- [ ] `apps/api/src/modules/auth`: register + login pasien & nakes, JWT sign, refresh (opsional). Pakai `@fastify/jwt` yang sudah terpasang.
- [ ] PreHandler global `authenticate` (verifikasi JWT) + `requireRole(role)` untuk RBAC (lihat [SECURITY.md](../docs/SECURITY.md)).
- [ ] Error handler terpusat: pastikan semua route return `{ error: { code, message, details? } }` (pola [API.md](../docs/API.md)).
- [ ] Helper idempotency di `apps/api/src/lib` (guard berbasis `event_id`/unique key) — siap dipakai webhook WA & event smartwatch (FR-2.2/AC-4).

## 1.3 Integrasi WhatsApp

- [ ] Buat `apps/api/src/integrations/whatsapp/WhatsAppService.ts` (interface + implementasi sandbox provider: Meta/360dialog/Twilio). Semua pesan keluar lewat service ini (AGENTS.md §8).
- [ ] Sediakan helper kirim pesan template (nama obat, dosis, waktu) + **interactive buttons** (`Sudah Minum` / `Tunda 15 menit`).
- [ ] Endpoint webhook WhatsApp: verifikasi signature + parse `event_id`, idempoten (dedup), log masuk ke `Notification`/`AuditLog`.
- [ ] Konfigurasi token/phone-id hanya via env (jangan commit secret).

## 1.4 Reminder Otomatis (Fitur 1)

- [ ] Scheduler berbasis **job queue persisten** (BullMQ + Redis) — bukan `setTimeout` (AGENTS.md §8). Daftarkan job per `Schedule` pasien.
- [ ] Trigger pengiriman pada jam sesuai zona waktu pasien, toleransi ±2 menit (AC-1.1).
- [ ] Pesan WA berisi nama obat, dosis, waktu + tombol interaktif (AC-1.2).
- [ ] Retry pengiriman maksimal 3× saat gagal + catat ke `ReminderLog`/log (AC-1.3).
- [ ] Pasien `voice_enabled=true` mendapat audio TTS (boleh stub/placeholder dulu di fase ini; full di Fase 3) (AC-1.4).
- [ ] Setelah reminder terkirim, buat/aktifkan **run eskalasi** state machine (state `WAITING_PATIENT`) dengan timeout default 30 menit (configurable).

## 1.5 Konfirmasi Kepatuhan 1-Tap (Fitur 2)

- [ ] Wire `POST /v1/compliance/confirm` (stub sudah ada di `apps/api/src/modules/compliance`) ke DB: tulis `compliance_logs` (`schedule_id`, `medication_id`, `patient_id`, `confirmed_at`) (AC-2.1).
- [ ] Handler webhook WA untuk tombol `Sudah Minum` → memanggil endpoint konfirmasi yang sama (AC-2.2).
- [ ] Idempoten: konfirmasi ganda tidak menambah record ganda (AC-2.2).
- [ ] Konfirmasi di luar jendela waktu → `confirmed_late` bukan `missed` (AC-2.3).
- [ ] Opsi `Tunda 15 menit` → re-schedule reminder + log (AC-2.4).
- [ ] Konfirmasi sebelum timeout → batalkan run eskalasi (state `RESOLVED`) (AC-3.4).

## 1.6 Auto-Eskalasi ke Keluarga (Fitur 3)

- [ ] Wire state machine (`apps/api/src/modules/escalation`) ke DB: simpan `escalation_runs` + `escalation_steps` (AC-7.4).
- [ ] Timeout scheduler: saat `WAITING_PATIENT` habis → transisi `FAMILY_TIER_1`, kirim notifikasi ke **semua kontak keluarga aktif** (AC-3.1).
- [ ] Kirim **hanya sekali per jendela eskalasi** (anti-spam) (AC-3.2).
- [ ] Notifikasi keluarga menyertakan instruksi/aksen menghubungi pasien (AC-3.3).
- [ ] Timeout eskalasi dikonfigurasi via env/config per pasien (default 30 menit) — bukan hardcode (AGENTS.md §2).
- [ ] Semua pengiriman notifikasi tercatat di `Notification` + `AuditLog`.

## 1.7 Mobile — Konfirmasi via App (minimal)

- [ ] `apps/mobile`: layar konfirmasi sederhana (tombol besar `Sudah Minum`, font ≥ 16pt).
- [ ] Deep link dari notifikasi WA/app menuju layar konfirmasi.
- [ ] Arahkan `EXPO_PUBLIC_API_URL` ke API lokal; panggil `POST /v1/compliance/confirm`.

## 1.8 QA Fase 1

- [ ] Unit test: scheduler/reminder (build job, retry), webhook dedup, compliance (confirmed/late/missed), eskalasi wiring ke DB.
- [ ] Demo script: reminder terkirim → pasien konfirmasi → eskalasi dibatalkan; dan variasi: pasien tidak respons → keluarga dialert.
- [ ] Definition of Done: `typecheck` + `lint` + `test` hijau; update `docs/API.md` untuk endpoint baru.
