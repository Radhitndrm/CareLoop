# TECH_STACK — Pilihan Teknologi CareLoop

**Versi:** 1.0 · **Terkait:** [ARCHITECTURE.md](ARCHITECTURE.md), [PRD.md](PRD.md)

Dokumen ini mencantumkan teknologi per layer, **alasan pemilihan**, **versi yang direkomendasikan**, dan **alternatif yang dipertimbangkan tapi tidak dipilih** beserta alasannya. Prinsip: cepat untuk hackathon, ramah demo, mudah di-swap.

---

## Ringkasan Cepat

| Layer | Dipilih | Alternatif ditolak |
|---|---|---|
| Monorepo tooling | npm workspaces + Turborepo | pnpm, Lerna, single repo |
| Bahasa | TypeScript (seluruh stack) | JavaScript, Go, Python |
| Web Dashboard | Next.js 14 (App Router) + Tailwind CSS | Vite+React, Vue/Nuxt |
| Mobile App | React Native (Expo) | Flutter |
| Backend API | Node.js + Fastify | NestJS, Express |
| Real-time | Socket.IO | native WS, SSE, MQTT |
| ORM / DB access | Prisma | Drizzle, TypeORM, Knex |
| Database | PostgreSQL 16 | MySQL, MongoDB, SQLite |
| Cache & Queue | Redis 7 + BullMQ | in-memory, RabbitMQ, Kue |
| WhatsApp | WhatsApp Business Cloud API (Meta) / 360dialog | Twilio (cadangan), bot wabot |
| Smartwatch | Google Fit / Apple HealthKit adapter | Samsung Health |
| TTS | Google Cloud Text-to-Speech | ElevenLabs, AWS Polly |
| Maps | Google Maps / Leaflet (OSM) | Mapbox |
| Auth | JWT + OTP WhatsApp | session/cookie, Passport |
| Deploy | Vercel (web) + Railway/Render (api) | Heroku, Fly.io, self-host |

---

## 1. Bahasa Pemrograman: TypeScript (semua layer)

- **Alasan**: Satu bahasa untuk web, mobile (React Native), dan backend → shared types (`packages/shared`) untuk API contract; tipe aman mengurangi bug di logika eskalasi kritis; ekosistem besar untuk integrasi.
- **Versi**: TypeScript 5.x, `strict: true`.
- **Alternatif ditolak**:
  - *JavaScript* — tidak ada type safety, risiko bug di state machine.
  - *Go* — performa bagus tapi menambah stack kedua (biaya tim kecil).
  - *Python (FastAPI)* — bagus untuk data, tapi menambah stack & membagi tipe dengan frontend.

## 2. Monorepo: npm workspaces + Turborepo

- **Alasan**: Bagi kode (`packages/shared`) tanpa publish; satu perintah install/lint/test; caching build.
- **Versi**: npm 10+, Turborepo 2.x.
- **Alternatif ditolak**: *pnpm* (bagus, tapi npm sudah cukup & lebih umum), *Lerna* (berat untuk kebutuhan ini).

## 3. Web Dashboard Nakes: Next.js 14 (App Router) + Tailwind

- **Alasan**: SSR + API routes terpadu (bisa prototipe cepat); routing & deployment (Vercel) murah; komponen React familiar; Tailwind cepat untuk UI kustom tanpa UI kit berat.
- **Versi**: Next.js 14.2+, React 18.3, Tailwind 3.4, Recharts (grafik kepatuhan), TanStack Query (data fetching), socket.io-client (real-time).
- **Alternatif ditolak**:
  - *Vite + React SPA* — tanpa SSR & tanpa integrasi deploy Vercel seintuitif Next.
  - *Vue/Nuxt* — tim RN/React sudah nyaman React.
  - *UI kit (MUI)* — berat & tidak optimal untuk aksesibilitas kustom lansia.

## 4. Mobile App Pasien/Keluarga: React Native (Expo)

- **Alasan**: Satu bahasa TS dengan backend; Expo = setup instan untuk hackathon (QR scan via Expo Go, tanpa perlu Xcode/Android Studio lengkap); akses GPS, deep link `tel:`; bisa sync HealthKit/Google Fit via plugin.
- **Versi**: Expo SDK 51+, React Native 0.74.
- **Alternatif ditolak**: *Flutter* — bagus performanya, tapi menambah bahasa (Dart) yang tidak dipakai di backend & tim; *PWA saja* — tidak cukup akses sensor smartwatch & pengalaman tombol darurat.

## 5. Backend API: Node.js + Fastify

- **Alasan**: Ringan & cepat (mendekati bare metal), TypeScript first-class, plugin ekosistem (rate-limit, CORS, JWT), dokumentasi otomatis (JSON Schema → Swagger) cocok untuk demo.
- **Versi**: Node.js 20 LTS, Fastify 4.x, `@fastify/jwt`, `@fastify/rate-limit`, `@fastify/cors`.
- **Alternatif ditolak**:
  - *NestJS* — kuat & terstruktur, tapi boilerplate besar untuk timeline 2–4 minggu. Dipakai jika tim lebih suka DI framework.
  - *Express* — lebih populer tapi middleware verbose & kinerja di bawah Fastify.
  - *Hono* — kandidat ringan, namun ekosistem Fastify lebih matang di tim.

## 6. Real-time: Socket.IO

- **Alasan**: Auto-reconnect, rooms (scope puskesmas/wilayah), fallback polling — robust untuk demo jaringan fluktuatif.
- **Versi**: socket.io 4.x.
- **Alternatif ditolak**: *native WebSocket* (perlu rebuild fitur reconnect/rooms), *SSE* (satu arah — cocok tapi client butuh lebih banyak kode), *MQTT* (overkill & infra tambahan).

## 7. ORM: Prisma

- **Alasan**: Migrasi + schema yang jelas dan *single source of truth* → selaras dengan `docs/DATABASE.md`; tipe otomatis; seed mudah; populer untuk demo cepat.
- **Versi**: Prisma 5.x.
- **Alternatif ditolak**: *Drizzle* (lebih dekat ke SQL & cepat — kandidat jika tim kuat SQL), *TypeORM* (config rumit), *Knex* (tanpa tipe migrate otomatis).

## 8. Database: PostgreSQL 16

- **Alasan**: Relasional + JSONB (fleksibel untuk data vital & metadata), enum, constraint, transaksi untuk logika kritis (eskalasi), kematangan hosting gratis (Railway/Render/Neon/Supabase).
- **Versi**: PostgreSQL 16.x (Railway/Render/Neon).
- **Alternatif ditolak**: *MySQL* (fitur JSON/tipe kurang), *MongoDB* (butuh relasi ketat antar tabel — pasien/kontak/log), *SQLite* (tidak cocok multi-worker & concurrency demo).

## 9. Cache & Queue: Redis 7 + BullMQ

- **Alasan**: Job queue persisten untuk timeout eskalasi & scheduler (lihat ADR-003); cache agregat dashboard & dedup webhook; tersedia gratis di Railway/Render.
- **Versi**: Redis 7, BullMQ 5.x.
- **Alternatif ditolak**: *RabbitMQ* (infra lebih berat), *in-memory queue* (hilang saat restart — hanya fallback demo, lihat ADR-010).

## 10. WhatsApp: WhatsApp Business Cloud API (Meta) / 360dialog

- **Alasan**: Resmi, mendukung template message + interactive buttons (konfirmasi 1-tap), sandbox untuk development. 360dialog / Meta Cloud API punya tier gratis developer. Twilio sebagai cadangan alternatif.
- **Versi**: Meta WhatsApp Cloud API v17+ / 360dialog API.
- **Alternatif ditolak**:
  - *wabot.js / Baileys (unofficial)* — cepat tapi melanggar ToS, riskan diblokir saat demo.
  - *Twilio sebagai utama* — lebih mahal per pesan; dipakai hanya fallback.
- **Catatan demo**: sandbox number untuk testing; template approval dimulai H-1 minggu.

## 11. Smartwatch: Adapter Google Fit / Apple HealthKit

- **Alasan**: Data detak jantung tersedia cross-platform; Google Fit punya REST API (server-to-server) — cocok demo; HealthKit via Expo plugin di iOS.
- **Versi**: Google Fitness API v1 (jangan tertukar dengan Health Connect baru — Health Connect adalah yang sekarang direkomendasikan Google untuk data kesehatan, pertimbangkan sebagai target); Apple HealthKit (iOS).
- **Alternatif ditolak**: *Samsung Health* (API terbatas), *perangkat proprietary* (vendor lock, butuh SDK).
- **Penting**: untuk MVP demo, implementasi mock utama (ADR-006); adapter riil dibuat belakangan bila waktu memungkinkan.

## 12. Text-to-Speech: Google Cloud Text-to-Speech

- **Alasan**: Kualitas Bahasa Indonesia sangat baik (waveNet/neural), mudah via REST/SDK, kuota gratis cukup untuk demo.
- **Versi**: Google Cloud TTS v1.
- **Alternatif ditolak**: *AWS Polly* (kualitas id ID oke tapi SDK terpisah), *ElevenLabs* (kualitas bagus tapi biaya & ID support), *edge-tts* (gratis tapi unofficial).

## 13. Geolocation & Maps: Google Maps Platform (+ Leaflet OSM fallback)

- **Alasan**: Geocoding akurat untuk "faskes terdekat"; Maps embed/link untuk alert keluarga (share location).
- **Versi**: Google Maps JavaScript API / Static Maps; Leaflet (openstreetmap) untuk opsi gratis penuh.
- **Alternatif ditolak**: *Mapbox* (overkill biaya), *TomTom* (ekosistem kecil).

## 14. Auth: JWT + OTP WhatsApp + RBAC sederhana

- **Alasan**: Stateless (mudah diskalakan), OTP WA sesuai ADR-009 (pasien lansia tanpa password), RBAC per role (patient/family/nakes/admin).
- **Versi**: `@fastify/jwt`, OTP via WA (6 digit, TTL 5 menit, max 5 percobaan), bcrypt untuk password nakes.
- **Alternatif ditolak**: *session/cookie* (stateful, lebih sulit untuk mobile), *OAuth* (dependency pihak ketiga & setup lama), *Firebase Auth* (ekosistem beda stack).

## 15. Deploy & Infra

| Komponen | Pilihan | Alasan |
|---|---|---|
| Web | Vercel | Gratis, satu klik dari Next.js |
| API + Worker (BullMQ) | Railway / Render | Gratis/murah, Postgres + Redis add-on, persistent queue |
| DB | Railway/Render Postgres (atau Neon/Supabase) | Managed, backup, TLS |
| Redis | Railway/Render Redis | Managed, persistent |
| File storage | Cloudflare R2 / S3 (opsional, untuk OCR) | Murah |
| CI | GitHub Actions (lint+typecheck+test) | Gratis, familiar |
| Container lokal | Docker Compose (postgres+redis) | Konsisten antar dev |

- **Alternatif ditolak**: *Heroku* (kebijakan free tier berubah), *Fly.io* (kurva belajar), *self-host* (ops cost).

## 16. Testing Stack

| Jenis | Tools |
|---|---|
| Unit (backend) | Vitest |
| Unit/Component (web & mobile) | Vitest / Jest + React Testing Library |
| Integration (API) | Vitest + Supertest + Testcontainers (opsional) |
| E2E web | Playwright |
| E2E mobile (light) | Detox (opsional — mahal waktu; demo manual cukup) |
| Mock third-party | MSW, Vitest mocks, WhatsApp sandbox |

> Detail di [docs/TESTING.md](docs/TESTING.md)

## 17. Utility Lain

- **Validation**: zod (shared schema di `packages/shared/validation`).
- **State machine eskala**: bisa plain TS switch (ringan) atau XState (bila tim mau). Rekomendasi MVP: **plain TS + exhaustive switch + union types** untuk menghindari dependency; XState hanya jika diagram state perlu divisualisasikan.
- **Scheduling**: `node-cron` untuk recurring job; BullMQ delayed job untuk timeout eskalasi.
- **Logging**: pino.
- **Env validation**: zod + dotenv.
- **Kode/formatter**: ESLint (typescript-eslint) + Prettier.
- **Charts dashboard**: Recharts.
- **Komponen web**: Tailwind + headlessui (aksesibel) — bukan UI kit penuh.

## 18. Matriks "Jika terpaksa ganti" (Keputusan Swap)

| Situasi | Swap ke | Catatan |
|---|---|---|
| API WA sandbox tidak approve | Twilio WhatsApp sandbox / ChatAPI | `WhatsAppService` interface sudah abstrak |
| Redis tidak tersedia di demo | DB-poller + InProcessQueue | ADR-010 |
| Expo Go bermasalah | PWA mobile dulu | Fitur GPS + deep link tetap ada di web |
| Google Maps tanpa API key | Leaflet OSM | geocode sederhana via Nominatim |
| Google Fit API rumit | Mock generator (default MVP) | demo tidak tergantung provider |
| Vercel limit | Netlify/Cloudflare Pages | Next.js build sama |
