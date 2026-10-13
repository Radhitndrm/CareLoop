# CareLoop

> Ekosistem kepatuhan pengobatan otomatis untuk pasien penyakit kronis di Indonesia — jembatan antara pasien, keluarga, dan tenaga kesehatan.

CareLoop adalah platform **digital health** untuk kompetisi hackathon bertema **SDG 3 — Digital Health for Better Living**. Fokus utama: **automasi penuh** agar mudah digunakan oleh lansia, dengan kanal interaksi utama **WhatsApp** (kanal yang sudah familiar), dukungan **smartwatch** untuk deteksi darurat, dan **jalur eskalasi bertingkat** (pasien → keluarga → nakes/kader) sebagai jaring pengaman.

---

## Daftar Isi

- [Masalah](#masalah)
- [Solusi](#solusi)
- [Diferensiasi](#diferensiasi)
- [Target Pengguna](#target-pengguna)
- [Fitur](#fitur)
- [Tech Stack (Ringkas)](#tech-stack-ringkas)
- [Struktur Folder](#struktur-folder)
- [Cara Install & Run](#cara-install--run)
- [Dokumentasi](#dokumentasi)
- [Tim / Kontributor](#tim--kontributor)
- [Roadmap](#roadmap)

---

## Masalah

1. **Putus obat karena lupa.** Pasien kronis (diabetes, hipertensi, TBC) sering berhenti minum obat karena tidak ada yang mengingatkan atau memantau.
2. **Aplikasi sejenis tidak cocok dengan realita pasien.**
   - Medisafe, Mobile JKN, PMO Puskesmas mengharuskan *install aplikasi baru*.
   - Belum terintegrasi dengan BPJS.
   - Tidak memakai kanal komunikasi yang sudah familiar (**WhatsApp**).
3. **Lansia rentan sendirian.** Banyak lansia/kronis tinggal jauh dari keluarga (anak merantau) atau tinggal sendiri tanpa pendamping. Saat terjadi kondisi darurat (anomali detak jantung, jatuh, tidak sadarkan diri) **tidak ada seorang pun di dekatnya** yang bisa menolong — keluarga baru tahu setelah terlambat.

## Solusi

CareLoop menghubungkan **pasien, keluarga, dan tenaga kesehatan** dalam satu ekosistem:

| Pihak | Platform | Peran |
|---|---|---|
| **Pasien** | Mobile App (React Native) + WhatsApp | Konfirmasi minum obat 1-tap, sync smartwatch, terima reminder suara |
| **Keluarga** | Mobile App + WhatsApp | Terima notifikasi kepatuhan & alert darurat (multi-kontak, termasuk kerabat jauh) |
| **Nakes / Dokter / Puskesmas** | Web Dashboard (Next.js) | Monitoring agregat kepatuhan, kelola pasien, jalur eskalasi cadangan |

Alur darurat singkat: **anomali detak jantung terdeteksi** → **konfirmasi ke pasien (timeout 30–60 dtk)** → jika tidak respons: **ambil GPS**, **alert WhatsApp ke keluarga**, **tombol one-tap call 112** (bukan auto-dial), **alert prioritas ke dashboard nakes**.

## Diferensiasi

- 💬 **Interaksi via WhatsApp** — pasien tidak perlu belajar aplikasi baru.
- 👨👩👧 **Eskalasi ke grup keluarga** (multi-kontak, bukan 1 kontak).
- 🏥 **Dirancang untuk adopsi lintas-puskesmas** (dashboard agregat per wilayah).
- 🚨 **Kombinasi kepatuhan obat + deteksi darurat otomatis** dalam satu sistem.
- 🛟 **Eskalasi bertingkat**: keluarga → keluarga lain/kerabat jauh → **nakes/kader terdekat** saat keluarga tidak bisa dihubungi atau jauh dari lokasi pasien.

## Target Pengguna

1. **Pasien penyakit kronis** (diabetes, hipertensi, TBC) — terutama lansia, termasuk yang tinggal sendiri / jauh dari keluarga.
2. **Keluarga / kerabat pasien** (di mana pun lokasinya).
3. **Tenaga kesehatan**: dokter, perawat, kader kesehatan, Puskesmas, Dinkes.

## Fitur

### MVP (wajib jalan saat demo)
1. Reminder otomatis via WhatsApp
2. Konfirmasi kepatuhan 1-tap
3. Auto-eskalasi ke grup keluarga jika tidak ada respons
4. Deteksi anomali detak jantung via smartwatch → konfirmasi pasien → timeout → lokasi GPS + alert WA keluarga + tombol one-tap call 112 + alert prioritas ke dashboard nakes
5. Dashboard monitoring kepatuhan (grafik, filter wilayah/penyakit)
6. Refill reminder otomatis
7. Eskalasi bertingkat: pasien → keluarga → nakes/kader terdekat (jaring pengaman terakhir)

### Tema SDG 3 (edukasi & aksesibilitas)
8. Edukasi kesehatan interaktif via chatbot WhatsApp
9. Skrining mandiri berkala
10. Pencarian faskes terdekat
11. Voice reminder (text-to-speech) untuk lansia dengan keterbatasan membaca

### Analitik & Dampak Sosial
12. Prediksi risiko berbasis tren data kepatuhan (rule-based, bukan ML berat)
13. Export data agregat (anonim) untuk riset/kebijakan Dinkes

### Lanjutan (bukan target MVP)
Gamifikasi, riwayat kesehatan terpusat, reminder kontrol dokter, forum komunitas, multi-bahasa, cek interaksi obat otomatis, mode offline/SMS fallback, verifikasi stok obat apotek, panel kader/posyandu, fitur "check-in" harian untuk pasien tinggal sendiri.

> Detail prioritas lengkap lihat [docs/PRD.md](docs/PRD.md) (MoSCoW).

## Tech Stack (Ringkas)

| Layer | Teknologi |
|---|---|
| Frontend Dashboard | Next.js + React + TypeScript + Tailwind |
| Mobile App | React Native (Expo) + TypeScript |
| Backend / API | Node.js + Fastify (atau NestJS) |
| Real-time | WebSocket (Socket.IO) |
| Database | PostgreSQL + Redis (opsional) |
| WhatsApp | WhatsApp Business API (Meta) atau Twilio |
| Deploy | Vercel (frontend) + Railway/Render (backend) |

> Detail lengkap + alasan + alternatif: [docs/TECH_STACK.md](docs/TECH_STACK.md)

## Struktur Folder

```
careloop/
├── README.md
├── AGENTS.md
├── docs/
│   ├── PRD.md              # Product Requirements Document
│   ├── ARCHITECTURE.md     # Arsitektur + ADR
│   ├── TECH_STACK.md       # Stack lengkap per layer
│   ├── DATABASE.md         # ERD & skema database
│   ├── API.md              # Dokumentasi REST API + WebSocket
│   ├── UI_UX.md            # User flow, wireframe, design system
│   ├── SECURITY.md         # Keamanan data kesehatan (UU PDP)
│   └── TESTING.md          # Strategi & rencana testing
├── apps/
│   ├── web/                # Web Dashboard (Next.js)
│   ├── mobile/             # Mobile App pasien (React Native/Expo)
│   └── api/                # Backend REST API (Node.js/Fastify)
├── packages/
│   └── shared/             # Shared types & utils (monorepo)
└── infra/
    └── docker-compose.yml  # PostgreSQL + Redis lokal
```

> Rincian struktur yang harus diikuti: [AGENTS.md](AGENTS.md)

## Cara Install & Run

> Prasyarat: Node.js 20+, Docker (opsional untuk DB lokal), akun WhatsApp Business API / Twilio (sandbox).

### 1. Clone & install dependencies

```bash
git clone https://github.com/<org>/careloop.git
cd careloop
npm install          # monorepo: workspace deps ter-install otomatis
```

### 2. Jalankan database lokal

```bash
cd infra && docker compose up -d   # PostgreSQL + Redis
```

Redis di-map ke port host **6380** (bukan 6379 default) supaya tidak bentrok dengan
container lain di mesin yang sama. Port di dalam container tetap 6379, jadi `REDIS_URL`
harus `redis://localhost:6380` — sudah sesuai dengan `apps/api/.env.example`.

> Redis bersifat opsional. Bila `REDIS_URL` kosong, queue jatuh ke mode in-process
> (`apps/api/src/lib/queue.ts`): pengingat & timeout eskalasi tetap jalan, tapi timer
> hilang saat server restart, sehingga kurang cocok untuk demo panjang.

### 3. Konfigurasi environment

Salin `.env.example` di setiap app menjadi `.env`, lalu isi (lihat [AGENTS.md](AGENTS.md#environment-variables) untuk daftar lengkap).

### 4. Jalankan backend

```bash
cd apps/api
npm run dev          # jalankan migrasi DB dulu: npm run db:migrate
```

### 5. Jalankan web dashboard

```bash
cd apps/web
npm run dev          # http://localhost:3000
```

### 6. Jalankan mobile app

```bash
cd apps/mobile
npm run start        # Expo dev server, scan QR dengan Expo Go
```

### Seed data demo

```bash
cd apps/api && npm run db:seed   # pasien, keluarga, nakes, jadwal obat contoh
```

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [AGENTS.md](AGENTS.md) | Konvensi coding untuk AI coding agent |
| [docs/PRD.md](docs/PRD.md) | Requirement, persona, user stories, acceptance criteria, MoSCoW, success metrics |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur per layer, alur data, ADR, scalability |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Teknologi per layer + alternatif |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD, skema tabel, indexing |
| [docs/API.md](docs/API.md) | Endpoint REST + WebSocket, contoh request/response |
| [docs/UI_UX.md](docs/UI_UX.md) | User flow, wireframe, prinsip desain lansia |
| [docs/SECURITY.md](docs/SECURITY.md) | Keamanan (UU PDP), auth, enkripsi, audit |
| [docs/TESTING.md](docs/TESTING.md) | Strategi testing MVP & integrasi pihak ketiga |

## Tim / Kontributor

| Nama | Role | Fokus |
|---|---|---|
| _(isi)_ | Project Lead | Koordinasi, PRD, presentasi |
| _(isi)_ | Backend Engineer | API, scheduler, eskalasi, integrasi WhatsApp |
| _(isi)_ | Mobile Engineer | App pasien, integrasi smartwatch |
| _(isi)_ | Frontend Engineer | Web Dashboard nakes |
| _(isi)_ | Design / UX | Desain aksesibilitas lansia, user flow |

## Roadmap

- **Minggu 1**: Fondasi (repo, DB schema, auth, webhook WhatsApp, scheduler dasar, app mobile). Slicing MVP fitur 1–3.
- **Minggu 2**: Fitur 4 (anomali → eskalasi darurat), fitur 5 (dashboard), fitur 7 (eskalasi bertingkat penuh).
- **Minggu 3**: Fitur 6 (refill), 8–11 (SDG), 12–13 (analitik & export). Polish UX lansia.
- **Minggu 4**: Hardening (testing kritis, security, demo data), latihan demo, pitch deck.

---

**Disclaimer hackathon**: CareLoop adalah *proof-of-concept* untuk hackathon. Fitur panggilan 112 tidak melakukan auto-dial langsung — hanya menyediakan tombol *one-tap call* setelah konfirmasi. Data yang dipakai di demo adalah data sintetis, bukan data pasien riil, dan tidak untuk keperluan medis sesungguhnya.
