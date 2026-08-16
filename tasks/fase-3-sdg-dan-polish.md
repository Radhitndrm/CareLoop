# Fase 3 — Fitur SDG & Polish UX (Minggu 3)

> Fitur PRD: **6 (Refill reminder)**, **8 (Chatbot edukasi)**, **9 (Skrining mandiri)**, **10 (Cari faskes)**, **11 (Voice reminder)**, **12 (Prediksi risiko)**, **13 (Export anonim)** + polish UX lansia.
> Target: fitur Should/Could (P1–P2) bekerja, dashboard & app mobile dipoles untuk demo.
> Referensi: [PRD §6 FR-6, FR-8..FR-13](../docs/PRD.md), [UI_UX](../docs/UI_UX.md).

## 3.1 Refill Reminder (Fitur 6)

- [ ] Job harian menghitung estimasi tanggal obat habis: `(jumlah stok ÷ dosis harian)` dari hari refill terakhir (AC-6.1).
- [ ] Pesan refill terkirim **H-3** sebelum perkiraan habis; diulang bila belum ada update stok (AC-6.2).
- [ ] Pasien/keluarga bisa menandai "sudah ambil obat" → `refill_confirmed` (AC-6.3).

## 3.2 Chatbot Edukasi WhatsApp (Fitur 8)

- [ ] Modul `apps/api/src/modules/education`: router keyword-based (`#edukasi`, menu button) (AC-8.1).
- [ ] Konten ≥ 10 topik untuk penyakit MVP (diabetes, hipertensi, TBC) (AC-8.2).
- [ ] Fallback: input tidak dikenal → arahkan kontak nakes/hotline (AC-8.3).
- [ ] Session log ke `ChatbotSession`/`ChatbotMessage`.

## 3.3 Skrining Mandiri (Fitur 9)

- [ ] Kuesioner singkat via WA/app (skor risiko diabetes/hipertensi) (FR-9.1).
- [ ] Hasil disimpan & menjadi input `risk_score` (AC-9.1); dibagi ke nakes hanya dengan persetujuan pasien (AC-9.2).
- [ ] Skor > ambang → rekomendasi konsultasi faskes (AC-9.3).

## 3.4 Pencarian Faskes Terdekat (Fitur 10)

- [ ] API `apps/api/src/modules/facilities`: daftar faskes berdasarkan lokasi + radius + jenis layanan (FR-10.1).
- [ ] Urutkan berdasarkan jarak; tampilkan alamat, jarak, jam buka, telepon (AC-10.1).
- [ ] Deep link buka Google Maps (AC-10.2).
- [ ] Seed data faskes sintetis (tidak memakai data riil).

## 3.5 Voice Reminder TTS (Fitur 11)

- [ ] Generator audio TTS bahasa Indonesia untuk pasien `voice_enabled` (AC-11.1).
- [ ] Fallback teks tetap terkirim jika TTS gagal (AC-11.2).

## 3.6 Prediksi Risiko Rule-Based (Fitur 12)

- [ ] Modul `apps/api/src/modules/risk`: skor 0–100 berbasis aturan (adherence 7/30 hari bobot besar, missed ≥ 3 hari beruntun, anomali/emergency 30 hari, hasil skrining, jeda kontrol) (FR-12.1).
- [ ] Kategori Rendah (<40), Sedang (40–69), Tinggi (≥70) (FR-12.2).
- [ ] Job harian perbarui `RiskPrediction` (AC-12.1).
- [ ] Pasien skor Tinggi tampil di dashboard "prioritas intervensi" (AC-12.2).

## 3.7 Export Data Agregat Anonim (Fitur 13)

- [ ] Modul `apps/api/src/modules/export`: export CSV/JSON agregat anonim (kepatuhan per wilayah/penyakit, jumlah insiden) (FR-13.1).
- [ ] Tidak mengandung PII (nama, NIK, no HP, alamat, lokasi presisi) — uji otomatis (AC-13.1).
- [ ] Rentang tanggal & filter konsisten dengan dashboard (AC-13.2).
- [ ] Aktivitas export tercatat di `audit_logs` (AC-13.3).

## 3.8 Polish UX Lansia

- [ ] Web: konsistensi tema, empty/loading/error state, responsive.
- [ ] Mobile: font ≥ 16pt, kontras tinggi, tombol besar, interaksi ≤ 2 tap (lihat [UI_UX.md](../docs/UI_UX.md)).
- [ ] Uji alur dengan 1–2 lansia (atau role-play) — catat temuan, perbaiki.

## 3.9 QA Fase 3

- [ ] Test: estimasi stok refill, aturan skor risiko (0–100), export anonim (bebas PII), chatbot routing.
- [ ] Definition of Done: `typecheck` + `lint` + `test` hijau; update `docs/` bila kontrak berubah.
