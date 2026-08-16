# Fase 2 — Darurat, Dashboard & Eskalasi Bertingkat (Minggu 2)

> Fitur PRD: **4 (Anomali → alert darurat)**, **5 (Dashboard nakes)**, **7 (Eskalasi bertingkat)**.
> Target: alur darurat `anomali → konfirmasi → alert keluarga + nakes + tombol 112` end-to-end, dashboard bisa dibuka nakes.
> Referensi: [PRD §6 FR-4, FR-5, FR-7](../docs/PRD.md), [ARCHITECTURE](../docs/ARCHITECTURE.md), [DATABASE](../docs/DATABASE.md), [UI_UX](../docs/UI_UX.md).

## 2.1 Ingest Data Smartwatch & Anomali (Fitur 4 — bagian data)

- [ ] Endpoint `POST /v1/vitals` (validasi zod) menyimpan `VitalSign` (source `SMARTWATCH`/`MOCK`).
- [ ] Adapter provider smartwatch di `apps/api/src/integrations` (interface; impl mock untuk demo, riil Google Fit/HealthKit bisa di-swap — AGENTS.md §8).
- [ ] Wire aturan anomali yang sudah ada (`apps/api/src/modules/vitals/anomaly.rules.ts`) ke ingest: HR < 50 atau > 120 bpm, ≥ 2 bacaan berurutan dalam 60 detik (FR-4.2).
- [ ] Saat anomali → buat `EmergencyAlert` state `EMERGENCY` + kirim konfirmasi ke pasien (WA + in-app) dengan timeout 30–60 detik (AC-4.1).

## 2.2 Alur Darurat & Alert (Fitur 4 — reaksi)

- [ ] Pasien konfirmasi "Saya aman" ≤ timeout → `RESOLVED`, keluarga **tidak** dialert (AC-4.2).
- [ ] Timeout/tidak respons → ambil lokasi GPS terakhir pasien (jika ada) (AC-4.3).
- [ ] Alert WA ke semua kontak keluarga (nama, kondisi, lokasi + link maps); tanpa lokasi tetap terkirim dengan "lokasi tidak tersedia" (AC-4.3).
- [ ] Alert prioritas ke dashboard nakes untuk pasien `living_situation=alone` tanpa family tier-1 aktif (AC-4.5).
- [ ] Tombol **one-tap call 112** (`tel:112`) di app dan di pesan WA — **tanpa auto-dial** (AC-4.6, constraint PRD).
- [ ] Semua kejadian tercatat di `emergency_alerts` + `audit_logs` (AC-4.7).
- [ ] Endpoint internal `/dev/mock-anomaly` untuk memicu anomali tanpa hardware (AGENTS.md §8).

## 2.3 Eskalasi Bertingkat Penuh (Fitur 7)

- [ ] Perluas state machine: run `WAITING_PATIENT → FAMILY_TIER_1 → FAMILY_TIER_2 → NAKES` (state machine sudah ada — pastikan integrasi DB + scheduler penuh).
- [ ] Timeout per tier configurable (default Tier-1 15 menit, Tier-2 15 menit) (AC-7.1).
- [ ] Respons "saya akan menghubungi pasien" (keluarga) / "saya tangani" (nakes) → `HANDLED`, hentikan eskalasi (AC-7.2).
- [ ] Pasien tanpa kontak tier-1/tier-2 → langsung tier-3 nakes tanpa menunggu timeout (AC-7.3).
- [ ] Timeout per pasien bisa diubah (misal lansia tinggal sendiri → lebih pendek) (AC-7.5).
- [ ] Verifikasi semua transisi tercatat di `escalation_runs`/`escalation_steps` (AC-7.4).

## 2.4 Dashboard Nakes (Fitur 5)

- [ ] API agregasi di `apps/api/src/modules/dashboard`: adherence rate = `konfirmasi_on_time / total_schedule` per periode (AC-5.1).
- [ ] Endpoint dashboard dengan filter: wilayah/kelurahan, jenis penyakit, rentang tanggal, status eskalasi (FR-5.2).
- [ ] Halaman dashboard di `apps/web`: ringkasan KPI + daftar pasien berisiko + grafik tren (FR-5.3). Tailwind 4 sudah siap.
- [ ] Filter tersimpan di URL (query param) agar bisa di-bookmark (AC-5.2).
- [ ] Scope data: dashboard hanya menampilkan data dalam scope nakes (RBAC, AC-5.3).
- [ ] List/panel "emergency aktif" untuk nakes menerima alert (AC-4.5).

## 2.5 QA Fase 2

- [ ] Test: alur anomali penuh (konfirmasi aman → resolved; timeout → alert keluarga + nakes), state machine multi-tier, kalkulasi adherence.
- [ ] Demo script: mock anomaly → alert end-to-end, buka dashboard, lihat emergency alert.
- [ ] Definition of Done: `typecheck` + `lint` + `test` hijau; update `docs/API.md` & `docs/DATABASE.md` bila kontrak berubah.
