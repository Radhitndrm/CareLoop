# Tasks — Checklist Pembangunan CareLoop

Checklist tugas per **fase** pembuatan aplikasi, mengikuti roadmap Minggu 1–4 di [README](../README.md#roadmap) dan acceptance criteria di [docs/PRD.md](../docs/PRD.md).

## Daftar Fase

| File | Fase | Cakupan (Fitur PRD) | Status |
|---|---|---|---|
| [fase-1-fondasi.md](fase-1-fondasi.md) | Fase 1 — Fondasi & Loop Kepatuhan (Minggu 1) | Fitur 1, 2, 3 + fondasi (DB, auth, WhatsApp, scheduler) | ▢ |
| [fase-2-darurat-dan-dashboard.md](fase-2-darurat-dan-dashboard.md) | Fase 2 — Darurat, Dashboard & Eskalasi Bertingkat (Minggu 2) | Fitur 4, 5, 7 | ▢ |
| [fase-3-sdg-dan-polish.md](fase-3-sdg-dan-polish.md) | Fase 3 — Fitur SDG & Polish UX (Minggu 3) | Fitur 6, 8, 9, 10, 11, 12, 13 | ▢ |
| [fase-4-hardening-demo.md](fase-4-hardening-demo.md) | Fase 4 — Hardening, Keamanan & Demo (Minggu 4) | Hardening, testing kritis, demo data, pitch | ▢ |
| [plan-operasional-puskesmas.md](plan-operasional-puskesmas.md) | Plan baru — Operasional Puskesmas & Onboarding End-to-End | Setup puskesmas, staf, onboarding pasien, aktivasi klinis, flow mobile, work queue | ▢ |

## Cara Pakai

1. **Sumber status utama = GitHub Issues** (repo `Radhitndrm/CareLoop`). Checklist fase di bawah/laman `tasks/` menjadi referensi requirement & acceptance criteria; centang isu di GitHub saat selesai.
2. Kerjakan **berurutan** — fase berikutnya baru boleh dimulai saat fase sebelumnya lulus *Definition of Done* (aturan MoSCoW: selesaikan P0 dulu).
3. Setiap isu menyebut file/tujuan konkret. Jika ada kode yang dibuat, patuhi [AGENTS.md](../AGENTS.md) (struktur folder, naming, validasi zod, error handling terpusat, UTC).
4. **Definition of Done** setiap item (dari AGENTS.md §5):

## Index Issue (GitHub)

Dibuat 2026-08-28 di repo `Radhitndrm/CareLoop`. Label: `prio:` (P0–P3), `area:` (platform/messaging/safety/dashboard/mobile/qa), `type:`, `size:`. Milestone: `M0`–`M4`.

| Milestone | Issues | Jumlah |
|---|---|---|
| **M0 Foundation** (milestone 2) | CL-001 Rekonsiliasi Kontrak Data · CL-002 Migrasi Prisma + Index Idempotency · CL-003 Infra + Fixture Test · CL-004 Error Handler · CL-005 Konfigurasi Runtime · CL-006 Login Nakes + JWT · CL-007 OTP Mock · CL-008 RBAC + Scope · CL-009 Guard Idempotency · CL-010 Helper Audit Log | 10 |
| **M1 Reminder & Kepatuhan P0** (milestone 3) | CL-101 WhatsApp Service+Mock · CL-102 Template/Parser · CL-103 Webhook Aman · CL-104 Queue BullMQ · CL-105 Kalkulasi Jadwal · CL-106 Worker Reminder · CL-107 Konfirmasi · CL-108 Tunda 15 menit · CL-109 Persistensi Escalation · CL-110 Timeout+Alert Keluarga · CL-111 Kontak Keluarga · CL-112 Webhook→Compliance · CL-113 Mobile Konfirmasi · CL-114 Integration Test F1 | 14 |
| **M2 Darurat & Dashboard P0** (milestone 4) | CL-201 Ingest Vital · CL-202 Aturan Anomali · CL-203 Adapter Smartwatch Mock · CL-204 Emergency dari Anomali · CL-205 Respons Pasien · CL-206 Timeout+Loc+Alert 112 · CL-207 Eskalasi Multi-Tier · CL-208 WebSocket · CL-209 API Dashboard · CL-210 Filter · CL-211 Web Nakes · CL-212 Panel Emergency · CL-213 Mobile Emergency · CL-214 Integration Test F2 | 14 |
| **M3 Fitur SDG & Polish** (milestone 5) | CL-301 Refill · CL-302 Chatbot · CL-303 Skrining · CL-304 Faskes · CL-305 TTS · CL-306 Risk Scoring · CL-307 Export Anonim · CL-308 Polish UX · CL-309 Test P1/P2 | 9 |
| **M4 Hardening & Demo** (milestone 6) | CL-401 Queue Recovery · CL-402 Security Hardening · CL-403 Health Check · CL-404 CI+E2E · CL-405 Seed Final · CL-406 Demo Journey · CL-407 Dokumentasi · CL-408 Pitch | 8 |

> **Pembagian 5 kontributor:** Platform (base/CL-001–010, schema, auth, security) · Messaging (CL-101–108) · Safety (CL-109–111, CL-201–207) · Dashboard (CL-208–212) · Mobile/QA (CL-113, CL-213–214).

   - [ ] `npm run typecheck` lulus
   - [ ] `npm run lint` lulus
   - [ ] Test unit baru untuk logika bisnis yang berubah
   - [ ] Tidak ada secret baru di repo
   - [ ] Update `docs/` jika kontrak (API/DB) berubah
   - [ ] Pesan commit conventional (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)

## Perintah Standar (jalankan dari root)

```bash
docker compose -f infra/docker-compose.yml up -d   # postgres + redis
npm run db:migrate                                 # migrasi Prisma
npm run db:seed                                    # seed data sintetis demo
npm run dev:api                                    # API di :4000
npm run dev:web                                    # dashboard di :3000
npm run dev:mobile                                 # Expo
npm run typecheck && npm run lint && npm run test  # verifikasi
```

## State Saat Ini (dibuat oleh scaffold)

Sudah ada & terverifikasi (bukan lagi tugas):
- Scaffold monorepo (npm workspaces + turbo), `tsconfig` strict, prettier.
- `infra/docker-compose.yml` (postgres 16 + redis 7).
- `packages/shared` — enums, tipe, dan zod schema bersama.
- Prisma schema lengkap (`apps/api/prisma/schema.prisma`, ±30 model) — `validate` & `generate` lulus, **belum ada migrasi**.
- **State machine eskalasi** (`apps/api/src/modules/escalation/state-machine.ts`) + unit test (15 kasus, ES-1..ES-12).
- **Aturan anomali HR** (`apps/api/src/modules/vitals/anomaly.rules.ts`) + unit test (8 kasus, AN-1..AN-7).
- Seed sintetis (`apps/api/prisma/seed.ts`) — Bu Ratna (ALONE, NAKES_FIRST) & Pak Haji (WITH_FAMILY).
- Modul API lain (auth, reminders, emergency, dashboard, dll.) masih **stub route** — diisi di fase 1–3.
- Web: halaman home saja. Mobile: template Expo default.
