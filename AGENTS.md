# AGENTS.md — Panduan untuk AI Coding Agent

Dokumen ini adalah **kontrak kerja** antara tim pengembang dan AI coding agent (misal: Claude Code, opencode, Copilot, Cursor) yang membantu development CareLoop. Tujuan: menjaga konsistensi, kecepatan, dan keamanan selama periode hackathon.

---

## 1. Tujuan Proyek (Bacaan Wajib Sebelum Ngoding)

CareLoop = platform **kepatuhan pengobatan otomatis** untuk pasien kronis di Indonesia, dengan kanal utama **WhatsApp**, dukungan smartwatch, dan **eskalasi darurat bertingkat** (pasien → keluarga → nakes/kader).

Sebelum menulis kode apa pun, baca minimal:
1. [README.md](README.md) — konteks & gambaran umum
2. [docs/PRD.md](docs/PRD.md) — requirement & acceptance criteria per fitur
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layer & alur data
4. [docs/DATABASE.md](docs/DATABASE.md) — skema DB yang harus diikuti
5. [docs/API.md](docs/API.md) — kontrak endpoint

Jika informasi tidak cukup, **bertanya dulu daripada berasumsi**.

---

## 2. Batasan Keras (Hard Constraints — JANGAN DILANGGAR)

### ❌ Tidak Boleh Dilakukan
1. **JANGAN implementasi auto-dial/auto-call 112.** Panggilan darurat hanya melalui tombol **one-tap call** (pasien/keluarga menekan manual). Tidak ada kode yang memulai panggilan telepon secara otomatis.
2. **JANGAN simpan atau hardcode data pasien riil di repo, test, atau seed data.** Semua data demo harus **sintetis/anonim** (misal nama `Bu Siti Test`, NIK dummy, no. HP `08xxxxxxxxxx`).
3. **JANGAN commit secret**: `.env`, API keys, token WhatsApp, JWT secret. File `.env*` harus di-`.gitignore`. Gunakan `.env.example`.
4. **JANGAN kirim pesan WhatsApp ke nomor riil** selain nomor sandbox yang disediakan. Untuk development gunakan WhatsApp **sandbox/test** provider.
5. **JANGAN bangun fitur ML berat.** Prediksi risiko wajib **rule-based** (threshold score), bukan model ML. Cukup sederhana untuk demo.
6. **JANGAN menambahkan dependency baru** tanpa alasan tertulis di commit/PR. Ini monorepo; audit dependency sangat penting untuk hackathon.
7. **JANGAN tulis komentar berlebihan** di kode — kode harus self-explanatory, nama variabel jelas. Komentar hanya untuk logika yang tidak trivial (misal aturan eskalasi).
8. **JANGAN refactor di luar scope task.** Jika menemukan masalah, catat, jangan refactor besar-besaran.
9. **JANGAN mengubah skema DB tanpa update `docs/DATABASE.md` dan migrasi.**

### ✅ Wajib Diperhatikan
1. **Waktu habis (timeout) eskalasi harus selalu konfigurable** lewat env/config, bukan hardcode di dalam fungsi (kecuali default). Lihat [docs/PRD.md](docs/PRD.md) untuk default: konfirmasi pasien 30–60 detik, eskalasi keluarga sesuai tier.
2. **Semua waktu ditangani dalam UTC di backend**; konversi ke WIB (UTC+7) dilakukan di frontend. Zona waktu pasien disimpan di profil.
3. **Idempotency**: webhook WhatsApp & event smartwatch bisa terkirim ganda — pastikan handler idempoten (pakai `event_id` / transaction guard).
4. **Tidak ada auto-commit**. Hanya commit saat diminta, dengan pesan yang jelas.
5. Jalankan **lint + test** sebelum menyatakan selesai (lihat bagian 5).

---

## 3. Prioritas Fitur

Urutan pengerjaan MVP (lihat MoSCoW lengkap di PRD):

| Priority | Fitur | Note |
|---|---|---|
| **P0 (Must — wajib demo)** | 1. Reminder WA | Fondasi scheduler + WhatsApp |
| | 2. Konfirmasi 1-tap | Backend + webhook WA |
| | 3. Auto-eskalasi keluarga | State machine eskalasi |
| | 4. Deteksi anomali → alert darurat | Smartwatch (mock) + GPS + 112 button + alert nakes |
| | 5. Dashboard monitoring | Grafik + filter |
| | 7. Eskalasi bertingkat → nakes | Multi-tier lengkap |
| **P1 (Should)** | 6. Refill reminder | Bergantung fitur 1–2 |
| | 8. Chatbot edukasi WA | Bisa simple keyword-based |
| | 9. Skrining mandiri | Form + skor |
| | 10. Cari faskes terdekat | Geolocation |
| | 11. Voice reminder | TTS |
| **P2 (Could)** | 12. Prediksi risiko rule-based | Score sederhana |
| | 13. Export agregat anonim | CSV/JSON |
| **P3 (Won't for MVP)** | Semua "rencana lanjutan" di README | Jangan dikerjakan kecuali diminta eksplisit |

**Aturan: selesaikan P0 sampai berfungsi end-to-end sebelum menyentuh P1/P2.** Jangan buat "fitur bagus" yang menghalangi fitur inti.

---

## 4. Struktur Folder (WAJIB Diikuti)

Monorepo (npm workspaces):

```
careloop/
├── apps/
│   ├── api/                 # Backend: Node.js + Fastify, TypeScript
│   │   ├── src/
│   │   │   ├── modules/     # Fitur per domain (1 folder 1 domain)
│   │   │   │   ├── patients/
│   │   │   │   ├── reminders/       # Scheduler & reminder WA
│   │   │   │   ├── compliance/      # Konfirmasi 1-tap
│   │   │   │   ├── escalation/      # State machine eskalasi
│   │   │   │   ├── emergency/       # Anomali + alert darurat
│   │   │   │   ├── vitals/          # Data smartwatch
│   │   │   │   ├── family/          # Keluarga & nakes contacts
│   │   │   │   ├── dashboard/       # Agregat untuk nakes
│   │   │   │   ├── education/       # Chatbot WA & skrining
│   │   │   │   ├── facilities/      # Faskes terdekat
│   │   │   │   ├── risk/            # Prediksi rule-based
│   │   │   │   ├── export/          # Export anonim
│   │   │   │   └── auth/
│   │   │   ├── integrations/  # WhatsApp, GPS, TTS, Google Fit/HealthKit, SMS
│   │   │   ├── lib/           # DB (Prisma/Drizzle), Redis, shared utils
│   │   │   └── index.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── tests/
│   │   └── .env.example
│   ├── web/                  # Dashboard nakes: Next.js + TS + Tailwind
│   │   ├── src/
│   │   │   ├── app/          # App Router
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   └── hooks/
│   │   └── .env.example
│   └── mobile/               # App pasien: React Native (Expo) + TS
│       ├── src/
│       │   ├── screens/
│       │   ├── components/
│       │   ├── services/     # HealthKit/Google Fit, deep link
│       │   └── navigation/
│       └── .env.example
├── packages/
│   └── shared/               # Shared TS types, enums, zod schemas
│       └── src/
│           ├── types/
│           ├── enums/
│           └── validation/
├── infra/
│   └── docker-compose.yml    # postgres + redis
├── docs/                     # Seluruh dokumentasi ini
└── package.json              # npm workspaces root
```

**Aturan folder:**
- Setiap fitur backend masuk ke folder `modules/<domain>/`. Jangan taruh semua di satu file `routes.ts`.
- Kode yang dipakai lintas domain taruh di `lib/` atau `packages/shared/` — bukan di module tertentu.
- Jangan buat folder `utils/` raksasa. Buat helper spesifik di tempat yang relevan.
- Naming: file `.ts` snake_case file? **Ikuti gaya yang sudah ada di repo.** Konsisten dengan kode yang sudah ada.

---

## 5. Perintah Standar

> Jalankan dari root monorepo.

```bash
npm run lint          # lint semua workspace (eslint + prettier)
npm run typecheck     # tsc --noEmit semua workspace
npm run test          # unit + integration test
npm run test:watch
npm run db:migrate    # (di apps/api) jalankan migrasi Prisma
npm run db:seed       # (di apps/api) seed data sintetis demo
npm run dev           # (di apps/api|web|mobile) dev server
```

**Definition of Done — agent wajib memenuhi:**
- [ ] `npm run typecheck` lulus (tidak ada `any` baru tanpa justifikasi)
- [ ] `npm run lint` lulus
- [ ] Test baru untuk logika bisnis yang berubah (khususnya eskalasi & reminder) — ikuti [docs/TESTING.md](docs/TESTING.md)
- [ ] Tidak ada secret baru di repo
- [ ] Update `docs/` jika kontrak (API/DB) berubah
- [ ] Pesan commit deskriptif (conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)

---

## 6. Environment Variables

Semua variabel via `process.env`, dan didaftarkan di `.env.example` masing-masing app. **Jangan pernah hardcode.**

| Variabel | App | Kegunaan |
|---|---|---|
| `DATABASE_URL` | api | Koneksi PostgreSQL |
| `REDIS_URL` | api | Opsional — cache & job queue |
| `JWT_SECRET` | api | Signing token |
| `WHATSAPP_TOKEN` | api | Token WhatsApp Business API |
| `WHATSAPP_PHONE_ID` | api | Nomor bisnis WA |
| `WA_WEBHOOK_VERIFY_TOKEN` | api | Verifikasi webhook WhatsApp |
| `NODE_ENV` | semua | `development`/`test`/`production` |
| `TZ_OFFSET` | api | Default offset jam pasien (WIB `+07:00`) |
| `NEXT_PUBLIC_API_URL` | web | Base URL API |
| `EXPO_PUBLIC_API_URL` | mobile | Base URL API |

---

## 7. Konvensi Kode

- **Bahasa kode**: Bahasa Inggris untuk identif*ier*/kode. Komentar & log boleh Bahasa Indonesia jika membantu (tapi minim). Dokumentasi & pesan UI yang menghadap pengguna: **Bahasa Indonesia**.
- **TypeScript strict** — jangan pakai `any` tanpa alasan.
- **Validasi input** di semua endpoint via zod (shared schema di `packages/shared/validation`).
- **API response shape** konsisten: `{ data, meta? }` untuk sukses, `{ error: { code, message, details? } }` untuk error (lihat [docs/API.md](docs/API.md#error-handling-convention)).
- **Error handling**: controller tidak menangkap semua error. Gunakan error handler terpusat di API layer.
- **Time**: simpan `timestamptz` UTC. Nama kolom waktu akhiri `_at`.
- **Enum & status**: definisikan di `packages/shared/src/enums` dan gunakan string enum di DB (bukan angka).
- **Komponen React**: functional component + hooks. Jangan buat class component.
- **Commit**: conventional commits, singkat, dalam Bahasa Inggris.

---

## 8. Catatan Penting Implementasi

### State Machine Eskalasi (kritis — baca sebelum edit)
Logika eskalasi tidak boleh diletakkan tersebar di handler. Implementasikan satu state machine (misal XState atau plain switch di `modules/escalation/`) dengan state: `WAITING_PATIENT` → `WAITING_FAMILY_TIER_1` → `WAITING_FAMILY_TIER_2` → `ESCALATED_TO_NAKES` → `RESOLVED` / `TIMED_OUT`. Transisi hanya via event yang terdefinisi. Semua timeout pakai scheduler/job (bukan `setTimeout` dalam proses yang bisa mati).

### WhatsApp
- Semua pesan keluar lewat satu `WhatsAppService` (di `integrations/whatsapp`) supaya mudah di-mock dan di-switch provider.
- Handler webhook wajib verifikasi signature + idempoten.
- Button interaktif WA (list/reply) untuk konfirmasi 1-tap.

### Smartwatch
- Untuk MVP demo: buat **adapter** yang memungkinkan mock data generator (misal endpoint internal `/dev/mock-anomaly`) agar demo bisa dipicu tanpa hardware. Provider riil (Google Fit/HealthKit) dipisah via interface agar bisa diganti.

### Timeout & Scheduler
- Gunakan job queue persisten (BullMQ + Redis) atau database-backed scheduler, bukan in-memory timer. Restart server tidak boleh menggagalkan eskalasi.

---

## 9. Alur Kerja untuk Agent

1. Baca dokumen relevan (bagian 1) sebelum mulai.
2. Cek kode yang ada di `modules/<domain>` target — ikuti pola yang sudah ada.
3. Implementasi minimal yang memenuhi acceptance criteria fitur tersebut. **Jangan over-engineer**.
4. Tulis/update test sesuai [docs/TESTING.md](docs/TESTING.md).
5. Jalankan lint + typecheck + test (bagian 5).
6. Update docs jika kontrak berubah.
7. Laporkan ringkas: apa yang dibuat, apa yang diuji, asumsi apa pun.

**Prinsip: "Ini hackathon."** Fokus pada demo yang jalan, bukan arsitektur yang sempurna. Namun keputusan yang memengaruhi keamanan & eskalasi darurat tetap diprioritaskan.
