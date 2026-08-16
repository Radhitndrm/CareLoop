# PRD — Product Requirements Document

**Project:** CareLoop — Ekosistem Kepatuhan Pengobatan & Deteksi Darurat
**Versi:** 1.0 (MVP untuk Hackathon)
**Tanggal:** 2026
**Owner:** CareLoop Team
**Tema:** SDG 3 — Digital Health for Better Living

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Non-Goals](#3-goals--non-goals)
4. [Target User & Persona](#4-target-user--persona)
5. [User Stories per Role](#5-user-stories-per-role)
6. [Fungsional Requirement + Acceptance Criteria](#6-fungsional-requirement--acceptance-criteria)
7. [Prioritas Fitur (MoSCoW)](#7-prioritas-fitur-moscow)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Success Metrics](#9-success-metrics)
10. [Out of Scope](#10-out-of-scope)
11. [Risiko & Mitigasi](#11-risiko--mitigasi)

---

## 1. Ringkasan Eksekutif

**CareLoop** adalah platform kepatuhan pengobatan otomatis untuk pasien penyakit kronis (diabetes, hipertensi, TBC) di Indonesia. Sistem menjembatani **pasien, keluarga, dan tenaga kesehatan** dalam satu ekosistem, dengan prinsip:

- **Automasi penuh** — mudah digunakan lansia, tanpa perlu belajar aplikasi baru.
- **Kanal familiar (WhatsApp)** — reminder, konfirmasi 1-tap, dan alert darurat.
- **Jaring pengaman darurat** — deteksi anomali via smartwatch → eskalasi bertingkat (pasien → keluarga → nakes/kader) → tombol one-tap call 112.
- **Skalabel untuk adopsi lintas-puskesmas** — dashboard monitoring agregat untuk nakes/Dinkes.

Target demo: alur reminder → konfirmasi → eskalasi, plus alur darurat anomali detak jantung end-to-end.

## 2. Problem Statement

### 2.1 Konteks
Pasien penyakit kronis di Indonesia wajib minum obat jangka panjang secara teratur. Kegagalan kepatuhan (adherence) → komplikasi, pembiayaan kesehatan naik, kematian yang seharusnya bisa dicegah.

### 2.2 Masalah Teridentifikasi
1. **Putus obat karena lupa/tidak ada yang memantau.** Tidak ada mekanisme reminder dan pemantauan yang berkelanjutan; keluarga tidak tahu pola kepatuhan pasien.
2. **Aplikasi sejenis tidak sesuai realita:**
   - Medisafe, Mobile JKN, PMO Puskesmas → harus *install app baru* → barrier tinggi untuk lansia.
   - Belum terintegrasi dengan BPJS/Kemenkes.
   - Tidak memanfaatkan kanal komunikasi yang **sudah familiar** (WhatsApp).
3. **Lansia rentan sendirian.** Banyak lansia/kronis tinggal **jauh dari keluarga** (anak merantau/kerja di kota lain) atau **tinggal sendiri**. Saat kondisi darurat (anomali detak jantung, jatuh, tidak sadarkan diri) tidak ada orang terdekat yang bisa menolong — keluarga baru tahu saat sudah terlambat.

### 2.3 Why Now
- Penetrasi WhatsApp di Indonesia sangat tinggi bahkan di segmen lansia.
- Pertumbuhan smartwatch yang terjangkau (subsidi/harga turun).
- Perhatian pemerintah terhadap integrasi platform kesehatan (SatuSehat) & SDG 3.
- Potensi adopsi lintas-puskesmas karena tidak perlu ganti kebiasaan pasien.

## 3. Goals & Non-Goals

### Goals (MVP)
- G1. Pasien menerima reminder minum obat otomatis via WhatsApp & mengonfirmasi dengan 1-tap.
- G2. Keluarga mendapat notifikasi kepatuhan & **alert darurat bertingkat** (bisa multi-kontak).
- G3. Anomali detak jantung dari smartwatch memicu alur darurat: konfirmasi → GPS → alert keluarga → tombol 112 → alert nakes.
- G4. Nakes/Puskesmas dapat memantau kepatuhan agregat per wilayah/penyakit dan menerima eskalasi sebagai jaring pengaman.
- G5. Adopsi lintas-puskesmas didukung oleh dashboard yang sederhana dan data export anonim untuk Dinkes.

### Non-Goals (MVP)
- NG1. Tidak ada prediksi ML berat — prediksi risiko rule-based saja.
- NG2. Tidak ada integrasi pembayaran/telebilling.
- NG3. Bukan pengganti diagnosis medis / alat medis resmi.
- NG4. Tidak ada integrasi penuh API BPJS (hanya placeholder/mock untuk demo).
- NG5. Tidak ada *auto-dial 112* (lihat Constraints).

### Constraints (Penting)
- **112 = tombol one-tap call**, BUKAN auto-dial. Alur: anomali → konfirmasi pasien (timeout 30–60 dtk) → jika tidak respons → kirim lokasi & alert ke keluarga + nakes + tampilkan tombol one-tap call 112.
- Semua data demo adalah **data sintetis** (UU PDP: tidak ada data pasien riil).
- Waktu pengembangan terbatas 2–4 minggu; dokumentasi mendukung strategi MVP realistis.

## 4. Target User & Persona

### P1. Pasien Lansia yang Tinggal Sendiri
- **Profil**: Bu Ratna, 72 tahun, hipertensi + diabetes tipe 2, janda, tinggal sendiri di rumah di Yogyakarta. Anak (Ari) kerja di Jakarta. Tangan agak gemetar, penglihatan menurun, tidak lancar baca font kecil.
- **Perilaku**: Punya HP Android murah, terbiasa pakai WhatsApp & menelepon. Pernah putus obat 3 minggu karena lupa & kehabisan stok tanpa sadar. Menolak aplikasi baru ("ribet, nggak ngerti").
- **Kebutuhan**: reminder yang tidak perlu dipelajari (WA), tombol besar, voice reminder, cara mudah konfirmasi ("tinggal tap 'Sudah Minum'").
- **Rasa takut**: "Kalau nanti sakit di rumah sendiri, siapa yang tahu?" → butuh jaring pengaman keluarga + nakes.

### P2. Keluarga yang Merantau (Jauh dari Pasien)
- **Profil**: Ari, 38 tahun, pekerja di Jakarta. Ingin tahu kepatuhan ibu tapi tidak bisa menelepon tiap hari. Pernah mendapati ibu jatuh di rumah tanpa sepengetahuannya.
- **Kebutuhan**: notifikasi ringkas kepatuhan mingguan, alert darurat real-time, lokasi pasien saat darurat, tombol one-tap call 112 / call kerabat terdekat.
- **Frustrasi**: aplikasi kesehatan pasarnya terlalu teknis; ingin "sekali setup, lalu otomatis."

### P3. Keluarga / Kerabat di Dekat Pasien (Tier 1)
- **Profil**: Sari, 45 tahun, tetangga/keponakan yang tinggal dekat Bu Ratna, sudah didaftarkan Bu Ratna sebagai kontak pertama.
- **Kebutuhan**: alert darurat prioritas (bisa datang), notifikasi kepatuhan jika pasien tak merespons.

### P4. Tenaga Kesehatan / Kader Puskesmas
- **Profil**: dr. Dewi, kepala Puskesmas Kecamatan; Nuning, kader posyandu kelurahan.
- **Kebutuhan**: melihat ringkasan kepatuhan per wilayah & per penyakit (dashboard), daftar pasien berisiko (kepatuhan rendah / sering darurat), menjadi **jalur eskalasi cadangan** untuk pasien tinggal sendiri, export data agregat anonim untuk laporan Dinkes.
- **Batasan**: waktu terbatas; ingin data "siap pakai", bukan klik-klik berlebihan.

### P5. Admin Puskesmas / Dinkes (sekunder)
- **Kebutuhan**: data agregat kepatuhan & insiden untuk kebijakan/kajian (anonim).

## 5. User Stories per Role

Format: *"Sebagai [role], saya ingin [action], sehingga [benefit]."*

### Role: Pasien
1. **US-P-01** Sebagai pasien, saya ingin menerima reminder minum obat via WhatsApp sesuai jadwal saya, sehingga saya tidak lupa minum obat. *(Fitur 1)*
2. **US-P-02** Sebagai pasien, saya ingin mengonfirmasi minum obat cukup dengan menekan satu tombol di WhatsApp, sehingga prosesnya semudah mungkin. *(Fitur 2)*
3. **US-P-03** Sebagai pasien lansia dengan gangguan membaca, saya ingin reminder bisa dibacakan (voice), sehingga saya tetap paham tanpa harus membaca. *(Fitur 11)*
4. **US-P-04** Sebagai pasien yang tinggal sendiri, saya ingin keluarga saya diingatkan jika saya tidak merespons, sehingga ada yang memeriksa saya. *(Fitur 3)*
5. **US-P-05** Sebagai pasien pengguna smartwatch, saya ingin sistem mendeteksi detak jantung abnormal dan meminta konfirmasi saya sebelum memicu alarm, sehingga tidak banyak false alarm. *(Fitur 4)*
6. **US-P-06** Sebagai pasien yang butuh obat lagi, saya ingin diingatkan saat stok obat menipis, sehingga saya tidak kehabisan obat. *(Fitur 6)*
7. **US-P-07** Sebagai pasien, saya ingin bertanya seputar penyakit/obat melalui WhatsApp, sehingga saya paham cara perawatan yang benar. *(Fitur 8)*
8. **US-P-08** Sebagai pasien, saya ingin melakukan skrining mandiri berkala, sehingga saya tahu kondisi saya dan bisa konsultasi lebih awal. *(Fitur 9)*
9. **US-P-09** Sebagai pasien, saya ingin mencari faskes terdekat, sehingga saya tahu ke mana harus berobat/refill. *(Fitur 10)*
10. **US-P-10** Sebagai pasien, saya ingin diberikan perkiraan risiko saya (misal risiko putus obat/komplikasi), sehingga saya lebih termotivasi disiplin. *(Fitur 12)*

### Role: Keluarga
1. **US-F-01** Sebagai keluarga, saya ingin menerima notifikasi kepatuhan (harian/ringkasan), sehingga saya bisa memantau dari jauh. *(Fitur 3/5)*
2. **US-F-02** Sebagai keluarga, saya ingin menerima alert darurat lengkap dengan lokasi & kondisi pasien, sehingga saya bisa bertindak cepat. *(Fitur 4)*
3. **US-F-03** Sebagai keluarga yang dekat (Tier 1), saya ingin diberi prioritas pertama saat darurat, sehingga saya bisa langsung ke lokasi. *(Fitur 7)*
4. **US-F-04** Sebagai keluarga yang jauh, saya ingin tetap menjadi jalur cadangan (Tier 2) bila keluarga terdekat tidak merespons. *(Fitur 7)*
5. **US-F-05** Sebagai keluarga, saya ingin bisa menambahkan lebih dari satu kontak kerabat & mengatur prioritas mereka, sehingga eskalasi fleksibel. *(Fitur 3/7)*
6. **US-F-06** Sebagai keluarga, saya ingin ada tombol one-tap call 112 saat darurat, sehingga saya bisa segera minta pertolongan resmi. *(Fitur 4)*

### Role: Nakes / Puskesmas
1. **US-N-01** Sebagai nakes, saya ingin melihat dashboard kepatuhan agregat (filter wilayah/penyakit/waktu), sehingga saya bisa fokus pada area berisiko. *(Fitur 5)*
2. **US-N-02** Sebagai nakes, saya ingin menerima alert prioritas untuk pasien yang sedang darurat dan tidak bisa dihubungi keluarga, sehingga saya bisa jadi jaring pengaman. *(Fitur 7)*
3. **US-N-03** Sebagai nakes, saya ingin mengelola data pasien & jadwal obat, sehingga data tetap akurat. *(Fitur 5)*
4. **US-N-04** Sebagai nakes, saya ingin melihat daftar pasien berisiko tinggi (kepatuhan rendah), sehingga intervensi tepat sasaran. *(Fitur 12)*
5. **US-N-05** Sebagai Dinkes, saya ingin men-download data agregat anonim, sehingga saya bisa membuat laporan/kebijakan. *(Fitur 13)*

## 6. Fungsional Requirement + Acceptance Criteria

### FR-1: Reminder Otomatis via WhatsApp *(Must)*
**FR-1.1** Sistem menjadwalkan reminder sesuai `schedule` obat pasien (jam, frekuensi, zona waktu pasien).
**FR-1.2** Pesan reminder via WhatsApp berisi nama obat, dosis, waktu, dan tombol interaktif (lihat FR-2).
**FR-1.3** Opsi voice reminder (TTS) untuk pasien yang menyalakannya.

**Acceptance Criteria**
- AC-1.1 Reminder terkirim pada jam yang dijadwalkan (±2 menit toleransi) sesuai zona waktu pasien.
- AC-1.2 Isi pesan benar sesuai jadwal (nama obat, dosis, waktu).
- AC-1.3 Jika pengiriman gagal (misal WhatsApp down), sistem mencoba ulang maksimal 3x dan mencatat failure ke log.
- AC-1.4 Pasien dengan `voice_enabled=true` menerima pesan audio/video note TTS, bukan hanya teks.

### FR-2: Konfirmasi Kepatuhan 1-Tap *(Must)*
**FR-2.1** Pasien mengonfirmasi "Sudah Minum" via tombol WhatsApp (interactive reply) atau via Mobile App (1-tap).
**FR-2.2** Sistem mencatat waktu konfirmasi di `compliance_logs`.

**Acceptance Criteria**
- AC-2.1 Konfirmasi terekam dengan benar (`schedule_id`, `medication_id`, `patient_id`, `confirmed_at`).
- AC-2.2 Konfirmasi via WhatsApp dan app menghasilkan record yang sama & idempoten (ganda tidak menambah record).
- AC-2.3 Pasien yang konfirmasi di luar jendela waktu (misal terlambat 2 jam) tetap tercatat sebagai `confirmed_late`, bukan `missed`.
- AC-2.4 Aksi "Belum minum / tunda 15 menit" didukung sebagai opsi alternatif.

### FR-3: Auto-Eskalasi ke Grup Keluarga jika Tidak Ada Respons *(Must)*
**FR-3.1** Jika pasien tidak mengonfirmasi dalam **waktu tunggu (default 30 menit, configurable)**, sistem mengirim notifikasi ke kontak keluarga.
**FR-3.2** Keluarga dapat menerima dalam bentuk pesan WA; lebih dari satu kontak didukung.

**Acceptance Criteria**
- AC-3.1 Tidak ada konfirmasi → notifikasi "pasien belum konfirmasi" terkirim ke semua kontak keluarga aktif di tier yang aktif.
- AC-3.2 Sistem hanya mengirim sekali per jendela eskalasi (tidak spam).
- AC-3.3 Notifikasi keluarga menyertakan link/instruksi untuk menghubungi pasien.
- AC-3.4 Jika pasien mengonfirmasi sebelum timeout, eskalasi dibatalkan & keluarga tidak menerima notifikasi.

### FR-4: Deteksi Anomali Detak Jantung → Alert Darurat *(Must)*
**FR-4.1** Integrasi data detak jantung dari smartwatch (Google Fit/HealthKit; **mock** untuk demo).
**FR-4.2** Deteksi anomali rule-based: HR < 50 atau > 120 bpm (default, configurable) yang bertahan ≥ 2 bacaan berurutan dalam 60 detik.
**FR-4.3** Alur: anomali → kirim konfirmasi ke pasien (WA + in-app) dengan **timeout 30–60 detik**.
**FR-4.4** Jika pasien konfirmasi "Saya aman" → batal (logged, tidak mengganggu).
**FR-4.5** Jika timeout/tidak respons →:
- Ambil lokasi GPS terakhir pasien (dengan permission tersimpan),
- Kirim **alert darurat WA ke semua kontak keluarga** (nama, kondisi, lokasi + link maps),
- **Alert prioritas ke dashboard nakes** (untuk pasien yang ditandai tinggal sendiri/tanpa keluarga dekat),
- Tampilkan **tombol one-tap call 112** di app & di pesan WA (deep link `tel:112`), **tanpa auto-dial**.

**Acceptance Criteria**
- AC-4.1 Anomali ≥ threshold → state `EMERGENCY` terbentuk & konfirmasi dikirim ke pasien.
- AC-4.2 Konfirmasi pasien diterima ≤ timeout → `RESOLVED` (keluarga TIDAK dialert).
- AC-4.3 Timeout → lokasi (jika ada) disertakan dalam alert; tanpa lokasi, alert tetap terkirim dengan keterangan "lokasi tidak tersedia".
- AC-4.4 Alert keluarga terkirim ke seluruh kontak aktif, terurut sesuai prioritas tier.
- AC-4.5 Pasien dengan `living_situation=alone` dan tanpa family tier-1 aktif → alert nakes otomatis terkirim.
- AC-4.6 Tombol 112 tersedia (one-tap), bukan auto-dial; tidak ada kode yang memulai panggilan otomatis.
- AC-4.7 Semua kejadian tercatat di `emergency_alerts` + `audit_logs`.

### FR-5: Dashboard Monitoring Kepatuhan *(Must)*
**FR-5.1** Dashboard nakes menampilkan: adherence rate per pasien, per puskesmas, per wilayah, per penyakit.
**FR-5.2** Filter: wilayah/kelurahan, jenis penyakit, rentang tanggal, status eskalasi.
**FR-5.3** Grafik: tren kepatuhan harian/mingguan, daftar pasien berisiko.

**Acceptance Criteria**
- AC-5.1 Data kepatuhan sesuai perhitungan: `adherence = konfirmasi_on_time / total_schedule` dalam periode.
- AC-5.2 Filter berfungsi dan URL bisa di-bookmark (query param).
- AC-5.3 Dashboard hanya menampilkan data pasien dalam scope nakes (lihat SECURITY).

### FR-6: Refill Reminder Otomatis *(Should)*
**FR-6.1** Berdasarkan estimasi sisa stok (jumlah & frekuensi dosis), sistem mengingatkan pasien & keluarga saat stok mendekati habis (default H-3).

**Acceptance Criteria**
- AC-6.1 Estimasi tanggal habis = (jumlah stok ÷ dosis harian) dari hari terakhir refill.
- AC-6.2 Pesan refill terkirim H-3 sebelum perkiraan habis; diulang bila belum ada update stok.
- AC-6.3 Pasien/keluarga bisa menandai "sudah ambil obat" (refill_confirmed).

### FR-7: Eskalasi Bertingkat (Multi-Tier) *(Must)*
**FR-7.1** Alur eskalasi bertingkat untuk **kepatuhan** dan **darurat**:
- Tier 1: keluarga/kerabat **terdekat** (didefinisikan pasien/keluarga),
- Tier 2: keluarga lain/kerabat jauh,
- Tier 3: **nakes/kader terdekat** (jaring pengaman terakhir untuk pasien tinggal sendiri/jauh dari keluarga).
**FR-7.2** Setiap tier memiliki timeout configurable (default: Tier1 15 menit, Tier2 15 menit).
**FR-7.3** Respons dari tier mana pun ("saya akan menghubungi pasien" / nakes "saya tangani") → state `HANDLED`, hentikan eskalasi.

**Acceptance Criteria**
- AC-7.1 Eskalasi berjalan sesuai urutan tier & timeout masing-masing.
- AC-7.2 Respons/handled di tier mana pun menghentikan eskalasi lebih lanjut.
- AC-7.3 Pasien yang tidak punya kontak tier-1/tier-2 → langsung masuk tier-3 (nakes) tanpa menunggu timeout.
- AC-7.4 Seluruh transisi state tercatat (`escalation_runs` + `escalation_steps`).
- AC-7.5 Konfigurasi timeout bisa diubah per pasien (misal lansia tinggal sendiri → timeout lebih pendek).

### FR-8: Edukasi Kesehatan via Chatbot WA *(Should)*
**FR-8.1** Chatbot keyword-based menjawab topik umum (penyakit, obat, gizi, jadwal kontrol).

**Acceptance Criteria**
- AC-8.1 Menu utama edukasi tersedia via perintah sederhana (`#edukasi`, menu button).
- AC-8.2 ≥ 10 topik konten tercantum (per penyakit MVP).
- AC-8.3 Jika tidak dikenal → fallback kontak nakes/hotline.

### FR-9: Skrining Mandiri Berkala *(Should)*
**FR-9.1** Kuesioner singkat (misal skor risiko diabetes/hipertensi) via WA/app, berkala (mingguan/bulanan sesuai pengaturan).

**Acceptance Criteria**
- AC-9.1 Hasil skrining tercatat & menjadi input `risk_score`.
- AC-9.2 Hasil dibagi dengan nakes bila pasien menyetujui.
- AC-9.3 Skor > ambang → rekomendasi konsultasi faskes.

### FR-10: Pencarian Faskes Terdekat *(Should)*
**FR-10.1** Pencarian puskesmas/rumah sakit/faskes terdekat berdasarkan lokasi pasien + radius + jenis layanan.

**Acceptance Criteria**
- AC-10.1 Daftar faskes diurutkan berdasarkan jarak; menampilkan alamat, jarak, jam buka, telepon.
- AC-10.2 Bisa dibuka di Google Maps (deep link).

### FR-11: Voice Reminder (TTS) *(Should)*
**FR-11.1** Reminder dengan audio TTS bahasa Indonesia untuk pasien `voice_enabled`.

**Acceptance Criteria**
- AC-11.1 Audio TTS berbahasa Indonesia, teks mengikuti konten reminder.
- AC-11.2 Fallback teks tetap dikirim jika TTS gagal.

### FR-12: Prediksi Risiko Rule-Based *(Could)*
**FR-12.1** Skor risiko 0–100 berbasis aturan:
- adherence rate 7/30 hari (bobot besar),
- missed consecutive ≥ 3 hari (+besar),
- anomali/emergency event dalam 30 hari (+),
- hasil skrining +,
- waktu sejak kontrol terakhir +.
**FR-12.2** Kategori: Rendah (<40), Sedang (40–69), Tinggi (≥70).

**Acceptance Criteria**
- AC-12.1 Skor dihitung dari data riil & diperbarui harian (job).
- AC-12.2 Pasien dengan skor Tinggi tampil di dashboard "prioritas intervensi".

### FR-13: Export Data Agregat (Anonim) *(Could)*
**FR-13.1** Export CSV/JSON agregat anonim (tanpa identitas) untuk Dinkes: kepatuhan per wilayah/penyakit, jumlah insiden.

**Acceptance Criteria**
- AC-13.1 Export tidak mengandung PII (nama, NIK, no HP, alamat, lokasi presisi).
- AC-13.2 Rentang tanggal & filter konsisten dengan dashboard.
- AC-13.3 Aktivitas export tercatat di audit log.

## 7. Prioritas Fitur (MoSCoW)

| Fitur | Prioritas | Alasan |
|---|---|---|
| 1. Reminder WA | **Must** | Fondasi kepatuhan |
| 2. Konfirmasi 1-tap | **Must** | Data kepatuhan |
| 3. Auto-eskalasi keluarga | **Must** | Diferensiasi & keselamatan |
| 4. Anomali → alert darurat | **Must** | Diferensiasi utama + SDG |
| 5. Dashboard nakes | **Must** | Adopsi lintas-puskesmas |
| 7. Eskalasi bertingkat → nakes | **Must** | Jaring pengaman lansia sendirian |
| 6. Refill reminder | **Should** | Mencegah putus obat |
| 8. Chatbot edukasi | **Should** | Tema SDG/edukasi |
| 9. Skrining mandiri | **Should** | Preventif |
| 10. Cari faskes | **Should** | Aksesibilitas |
| 11. Voice reminder | **Should** | Aksesibilitas lansia |
| 12. Prediksi risiko | **Could** | Nilai tambah, rule-based murah |
| 13. Export anonim | **Could** | Nilai dampak sosial |
| Gamifikasi, forum, multi-bahasa, dll. | **Won't (MVP)** | Rencana lanjutan |

## 8. Non-Functional Requirements

| Aspek | Requirement |
|---|---|
| **Ketersediaan** | Backend minimal 99% uptime selama demo; crash server tidak menghilangkan job eskalasi yang tertunda (queue persisten). |
| **Latency** | API < 500ms (p95) untuk aksi non-batch; pengiriman WA < 60 detik dari trigger (biasa ~detik). |
| **Keamanan** | Sesuai [SECURITY.md](SECURITY.md): auth JWT, RBAC, enkripsi PII, audit log, rate limiting. |
| **Aksesibilitas** | Desain lansia: font ≥ 16pt, kontras tinggi, interaksi ≤ 2 tap (lihat [UI_UX.md](UI_UX.md)). |
| **Skalabilitas** | Desain mendukung 10k pasien/bulan pada 1 instance (aransemen: job queue + read replica opsional). |
| **Portabilitas** | WhatsApp provider bisa di-swap (adapter); smartwatch adapter bisa di-mock. |
| **Compliance** | Data sintetis di semua environment; prinsip UU PDP diterapkan (minimal data, consent, hak pasien). |

## 9. Success Metrics

| Metrik | Target MVP | Cara Ukur |
|---|---|---|
| Adherence rate rata-rata (demo) | ≥ 85% pada pasien demo | `compliance_logs` |
| % reminder terkirim tepat waktu | ≥ 98% | log scheduler |
| Median waktu respons pasien | ≤ 10 menit | selisih `scheduled_at` → `confirmed_at` |
| Waktu eskalasi darurat → alert keluarga | ≤ 2 menit | timeline `emergency_alerts` |
| False-positive alarm (konfirmasi "aman") | ≤ 30% dari anomali | `emergency_alerts` |
| Nakes akses dashboard aktif | 100% tim nakes demo | analitik login |
| User stories P0 selesai end-to-end | 7/7 | checklist demo |
| Waktu setup pasien baru | ≤ 5 menit | demo script |
| Kepuasan lansia (simplest usability) | ≥ 4/5 | feedback demo |

## 10. Out of Scope (MVP)

- Integrasi penuh API BPJS/OCR resep (placeholder).
- Auto-dial 112, panggilan suara otomatis, SMS gateway riil.
- Machine learning / AI model (semua rule-based).
- Multi-bahasa, offline mode, forum, gamifikasi, verifikasi stok apotek, panel kader, interaksi obat (all rencana lanjutan).
- Payment/telemedicine.
- Compliance medis penuh (bukan medical device; demo hanya proof-of-concept).

## 11. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| WhatsApp Business API butuh approval lama | Tinggi | Pakai **sandbox** (Meta Business/360dialog/Twilio) dari awal; adopsi flow pesan template + interactive buttons. |
| Smartwatch tidak tersedia di demo | Tinggi | Adapter mock data (endpoint internal trigger anomali) → demo tetap jalan. |
| Timeout/scheduler hilang saat server restart | Tinggi | Job queue persisten (Redis/BullMQ) + DB-backed state; job dikembalikan saat restart. |
| User (lansia) bingung dengan flow | Sedang | Konfirmasi 1-tap, tombol besar, teks sederhana, voice; uji dengan 1–2 lansia sebelum demo. |
| Scope melebar | Tinggi | MoSCoW ketat; fitur P0 diselesaikan dulu; PRD ini jadi pagar. |
| Data privacy (UU PDP) | Sedang | Data sintetis; RBAC; audit log; minimisasi data. |
| Webhook ganda/idempotency | Sedang | `event_id` dedup + transaksi DB. |
| Waktu terbatas (2–4 minggu) | Tinggi | Slicing per minggu (lihat README roadmap); prioritaskan demo journey tunggal yang halus. |
