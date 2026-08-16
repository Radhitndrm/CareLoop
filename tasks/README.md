# Tasks — Checklist Pembangunan CareLoop

Checklist tugas per **fase** pembuatan aplikasi, mengikuti roadmap Minggu 1–4 di [README](../README.md#roadmap) dan acceptance criteria di [docs/PRD.md](../docs/PRD.md).

## Daftar Fase

| File | Fase | Cakupan (Fitur PRD) | Status |
|---|---|---|---|
| [fase-1-fondasi.md](fase-1-fondasi.md) | Fase 1 — Fondasi & Loop Kepatuhan (Minggu 1) | Fitur 1, 2, 3 + fondasi (DB, auth, WhatsApp, scheduler) | ▢ |
| [fase-2-darurat-dan-dashboard.md](fase-2-darurat-dan-dashboard.md) | Fase 2 — Darurat, Dashboard & Eskalasi Bertingkat (Minggu 2) | Fitur 4, 5, 7 | ▢ |
| [fase-3-sdg-dan-polish.md](fase-3-sdg-dan-polish.md) | Fase 3 — Fitur SDG & Polish UX (Minggu 3) | Fitur 6, 8, 9, 10, 11, 12, 13 | ▢ |
| [fase-4-hardening-demo.md](fase-4-hardening-demo.md) | Fase 4 — Hardening, Keamanan & Demo (Minggu 4) | Hardening, testing kritis, demo data, pitch | ▢ |

## Cara Pakai

1. Kerjakan **berurutan** — fase berikutnya baru boleh dimulai saat fase sebelumnya lulus *Definition of Done* (aturan MoSCoW: selesaikan P0 dulu).
2. Centang item dengan `- [x]` saat selesai, dan tulis nama + tanggal di samping item bila perlu.
3. Setiap item menyebut file/tujuan konkret. Jika ada kode yang dibuat, patuhi [AGENTS.md](../AGENTS.md) (struktur folder, naming, validasi zod, error handling terpusat, UTC).
4. **Definition of Done** setiap item (dari AGENTS.md §5):
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
