# UI/UX — User Flow, Wireframe & Design System

**Versi:** 1.0 · **Terkait:** [PRD.md](PRD.md) (persona), [API.md](API.md)

Tujuan desain CareLoop: **"Tidak perlu dipelajari."** Target utama adalah lansia 60+ dengan keterbatasan membaca/penglihatan dan keluarga yang sibuk. Prinsip: interaksi minimum, teks besar, kontras tinggi, pilihan sedikit, dan kanal yang sudah familiar (WhatsApp).

---

## Daftar Isi

1. [Prinsip Desain](#1-prinsip-desain)
2. [Prinsip Aksesibilitas Lansia](#2-prinsip-aksesibilitas-lansia)
3. [User Flow per Role](#3-user-flow-per-role)
4. [User Flow Khusus: Pasien Tanpa Keluarga Terdekat](#4-user-flow-khusus-pasien-tanpa-keluarga-terdekat)
5. [Wireframe Tekstual per Layar Utama](#5-wireframe-tekstual-per-layar-utama)
6. [Design System](#6-design-system)
7. [Pesan WhatsApp (Copy)](#7-pesan-whatsapp-copy)
8. [Accessibility Checklist](#8-accessibility-checklist)

---

## 1. Prinsip Desain

1. **One-tap first**: Setiap aksi penting = maksimal 1 ketukan (WhatsApp button atau tombol besar). Konfirmasi, "Saya aman", "Hubungi pasien".
2. **Tidak ada keputusan kosong**: Setiap layar memiliki satu aksi utama (primary button) yang jelas.
3. **Warna sebagai pengaman**: Hijau = aman/sukses, Merah = darurat/berbahaya, Kuning = perlu perhatian. Tidak ada abu-abu membingungkan di jalur kritis.
4. **Konsistensi kanal**: Alur yang sama di WhatsApp & App. Notifikasi app mengarahkan ke aksi yang sama dengan WA.
5. **Lansia-first, bukan developer-first**: Bahasa sederhana, kalimat pendek, kalimat aktif ("Anda harus minum obat sekarang").
6. **Keluarga "set-and-forget"**: Sekali setup, keluarga hanya menerima notifikasi ringkas; tanpa login wajib (WA OTP).
7. **Real-time yang terasa**: Dashboard nakes dapat alert darurat dalam < 1 detik (WebSocket).

## 2. Prinsip Aksesibilitas Lansia

| Aspek | Standar CareLoop |
|---|---|
| Ukuran font | **≥ 16px** body; label tombol ≥ 18px; bisa zoom 200% tanpa pecah |
| Kontras | ≥ 4.5:1 teks; ≥ 3:1 elemen grafis (WCAG AA) |
| Target sentuh | ≥ 48×48dp; tombol darurat ≥ 64dp |
| Interaksi | Maks 1–2 tap per aksi; tidak ada swipe gesture wajib |
| Baca | Voice reminder (TTS) untuk keterbatasan baca; teks pendek + ikon |
| Waktu | Tidak ada auto-logout yang menyebalkan; timeout tetap ada tapi diberi peringatan |
| Bingung | "Kembali" selalu terlihat; satu pilihan utama; teks tanpa jargon medis (pakai istilah sederhana + istilah medis kecil) |
| Visual | Ikon besar + label teks; jangan ikon saja |
| Peringatan | Darurat: suara + getar + layar penuh; non-darurat: notifikasi biasa |
| Kognitif | Langkah linear, bukan alur bercabang di layar utama |

## 3. User Flow per Role

### 3.1 Alur Pasien (harian)

```
Menerima reminder WA
   ├─ Tap "Sudah Minum" ──────→ log CONFIRMED ──→ (berhenti)
   ├─ Tap "Tunda 15 menit" ──→ reminder ulang ──→ konfirmasi/eskalasi
   └─ Tidak ada respons 30 mnt
        → Keluarga Tier 1 dialert
        → (bila tak ada) Tier 2
        → (bila tak ada / tinggal sendiri) Nakes
```

### 3.2 Alur Darurat Pasien (anomali detak jantung)

```
Smartwatch mendeteksi HR > 120 (2×)
   └─ WA/App: "Deteksi detak jantung tinggi. Apakah Anda aman?" (2 tombol)
        ├─ "Saya aman" ──→ RESOLVED_SAFE (tanpa alert)
        └─ "Saya butuh bantuan" / timeout 30–60 dtk
             ├─ Ambil lokasi GPS terakhir
             ├─ Alert keluarga (WA): kondisi + lokasi + [tel:112]
             ├─ Alert nakes (dashboard prioritas) bila pasien alone / tak ada keluarga dekat
             └─ Layar app: tombol besar [Panggil 112] (one-tap call)
```

### 3.3 Alur Keluarga

```
Terima notifikasi (WA):
   ├─ Ringkasan harian kepatuhan ──→ view app (opsional)
   ├─ Alert "Bu Ratna belum minum obat" ──→ [Hubungi pasien] / [Sudah ditangani]
   └─ Alert DARURAT ──→ WA: lokasi + [tel:112] + [Saya ke lokasi]
        → "Saya ke lokasi" menghentikan eskalasi berikutnya
```

Setup keluarga (sekali): terima OTP → isi nama → pilih tier (dekat/jauh) → aktif.

### 3.4 Alur Nakes

```
Login (username+password)
   └─ Dashboard
        ├─ Ringkasan: total pasien, adherence, alert aktif
        ├─ Grafik kepatuhan (filter wilayah/penyakit/tanggal)
        ├─ Daftar pasien berisiko tinggi
        ├─ Feed alert darurat (real-time via WebSocket)
        │    └─ [Buka detail] → lokasi, kontak, aksi "Saya tangani"
        └─ Export anonim (admin/Dinkes)
```

### 3.5 Alur Eskalasi Bertingkat (keluarga & nakes — satu diagram)

```
[Tidak ada konfirmasi pasien]
   └─ Tier 1 (keluarga dekat) — timeout 15 menit
        ├─ di-handle → SELESAI
        └─ timeout
             └─ Tier 2 (keluarga jauh) — timeout 15 menit
                  ├─ di-handle → SELESAI
                  └─ timeout / tak ada kontak
                       └─ Tier 3 (nakes/kader terdekat) — jaring pengaman
                            ├─ di-handle → SELESAI
                            └─ timeout → TIMED_OUT (log + laporan)
```

## 4. User Flow Khusus: Pasien Tanpa Keluarga Terdekat

**Skenario**: Bu Ratna tinggal sendiri, anak di Jakarta (Tier 2), tidak ada keluarga dekat (Tier 1 kosong).

### 4.1 Setup
1. Nakes mendaftarkan Bu Ratna + menandai `livingSituation = ALONE` dan `hasNearbyFamily = false`.
2. Bu Ratna menambahkan anak Ari sebagai Tier 2 (jauh).
3. Sistem otomatis memetakan jalur eskalasi: **Tier 2 (Ari) → Tier 3 (kader/nakes setempat)** — Tier 1 dilewati (lihat FR-7 & AC-7.3).

### 4.2 Darurat
1. Anomali HR → konfirmasi Bu Ratna (timeout 30 dtk — **lebih pendek** untuk pasien alone).
2. Timeout → alert **langsung ke Tier 2 (Ari)** + **alert prioritas ke nakes setempat** secara paralel (bukan menunggu 15 menit) karena `emergencyPreference = NAKES_FIRST` (configurable).
3. Alert nakes berisi lokasi + peringatan "pasien tinggal sendiri, tidak ada keluarga terdekat" → prioritas visual tertinggi.
4. Siapa pun yang handle (Ari atau kader) menghentikan eskalasi.

### 4.3 Refill
- Karena tidak ada yang dekat, reminder refill ke Bu Ratna **dan** Ari; dashboard nakes menampilkan badge "refill pending" pada daftar pasien alone.

## 5. Wireframe Tekstual per Layar Utama

> Format: deskripsi layout atas→bawah. Untuk MVP, prioritas: (A) WA flow, (B) App pasien, (C) Dashboard nakes, (D) App keluarga.

### 5.1 (A) WhatsApp — Pesan Reminder

```
[CareLoop] 10:00

💊 Reminder Obat
Bu Ratna, waktunya minum obat:

  Metformin 500 mg — 1 tablet
  (setelah makan)

[ Sudah Minum ] [ Tunda 15 menit ]

Balas INFO untuk edukasi, cek menu.
```

- Tombol besar (WA interactive buttons), teks singkat, ikon obat.
- Voice user: dapat juga mengirim audio note TTS.

### 5.2 (B) App Pasien — Home (Layar Utama)

```
┌──────────────────────────────┐
│   ☀ Selamat pagi, Bu Ratna  │
│   (ringkasan: 3 obat hari ini)│
│                              │
│   [ 🔴 Panggil 112 ]  (hanya │
│      muncul saat darurat)    │
│                              │
│   ┌── Obat berikutnya ─────┐ │
│   │ Metformin 08:00  [✓]   │ │
│   │ Amlodipine 08:00 [✓]   │ │
│   │ Glimepiride 20:00 [   ]│ │
│   └─────────────────────────┘ │
│                              │
│   [ 💬 Chat Edukasi ]        │
│   [ 🏥 Faskes Terdekat ]     │
│   [ 📋 Skrining ]            │
└──────────────────────────────┘
```

- Tombol 112 dalam keadaan **tersembunyi** kecuali darurat (mengurangi rasa panik).

### 5.2.1 (B) App Pasien — Layar Konfirmasi & Deep Link (CL-113)

```
┌──────────────────────────────────────┐
│   CareLoop                           │
│   Kepatuhan Obat & Bantuan Darurat   │
│                                      │
│   [ 🔗 Terbuka dari tautan WA ]      │ ← muncul jika via deep link
│                                      │
│   ┌── Waktunya Minum Obat ─────────┐ │
│   │ Metformin 500 mg               │ │
│   │ 1 tablet setelah sarapan pagi  │ │
│   │ [ ⏰ 08:00 WIB ]                │ │
│   │ ID: 11111111-1111-4111-...     │ │
│   └────────────────────────────────┘ │
│                                      │
│   [ ✅ Obat Berhasil Dikonfirmasi! ] │ ← banner sukses hijau
│   (atau ❌ Konfirmasi Gagal)         │ ← banner gagal merah + retry
│                                      │
│   [ 💊 Sudah Minum ] (hijau, 60dp)   │ ← font 20px, one-tap API POST
│                                      │
│   [ 📞 Panggil 112 ] (merah, 60dp)   │ ← one-tap tel:112 (bukan auto)
└──────────────────────────────────────┘
```

- **Prinsip Aksesibilitas**:
  - Tombol aksi utama berukuran besar (`minHeight: 60dp`), ukuran font label `20px` (memenuhi standar lansia ≥ 16px).
  - Indikator loading (`ActivityIndicator`) saat memanggil endpoint API `POST /v1/compliance/confirm`.
  - Banner hasil: hijau kontras tinggi (`#DCFCE7`/`#16A34A`) saat sukses, merah kontras tinggi (`#FEE2E2`/`#DC2626`) saat gagal.
- **Dukungan Deep Link**:
  - Skema kustom: `careloop://confirm?scheduleId=<uuid>` atau `careloop://confirm/<uuid>`.
  - Fallback URL: `http://<host>/confirm?scheduleId=<uuid>`.
  - Ekstraksi otomatis `scheduleId` saat cold start (`Linking.getInitialURL`) maupun warm start (`Linking.addEventListener`).

### 5.3 (B) App Pasien — Layar Darurat (Full Screen, bergetar)

```
┌──────────────────────────────┐
│ 🔺 EMERGENCY                  │
│                              │
│ Deteksi detak jantung tinggi │
│ (145 bpm).                   │
│                              │
│ Apakah Anda merasa aman?     │
│                              │
│  [ 🟢 Saya Aman ]            │
│  [ 🆘 Saya Butuh Bantuan ]   │
│                              │
│ Menunggu respons: 45 detik   │
│ (progress bar besar)         │
└──────────────────────────────┘
```

- Setelah timeout: layar berubah → lokasi terkirim + tombol besar `[ 📞 Panggil 112 ]` (one-tap `tel:112`).

### 5.4 (C) Dashboard Nakes — Overview (CL-211)

```
┌────────────────────────────────────────────────────────┐
│ [Logo] CareLoop NAKES   [dr. Siti (Puskesmas Jetis)▾] │
│ Ringkasan Monitoring                                  │
├────────────────────────────────────────────────────────┤
│ 🚨 Alert Darurat Aktif: 2 (merah menyala / pulse)      │
├────────────────────────────────────────────────────────┤
│ Filter: [Wilayah] [Penyakit▾] [Dari-Sampai] [Status▾]  │
│ [Terapkan] [Reset]  (tersimpan di URL query param)    │
├────────────────────────────────────────────────────────┤
│ KPI Cards:                                             │
│ 1. Kepatuhan (Adherence): 88%  ▲ Naik                 │
│    (105 tepat · 12 tunda · 15 terlewat)                │
│ 2. Total Pasien: 120                                  │
│ 3. Pasien Berisiko Tinggi: 7                           │
│ 4. Darurat Aktif: 2                                   │
│ 5. Eskalasi Aktif: 3                                  │
├────────────────────────────────────────────────────────┤
│ [ Grafik Garis Tren Harian (SVG) ] [ Bar Penyakit ]    │
├────────────────────────────────────────────────────────┤
│ Tabel Pasien Berisiko Tinggi (skor >= 70 / HIGH):      │
│ • Bu Ratna — Alone — Diabetes — Skor 82 — Dosis Lewat 3│
│ • Pak Slamet — With Family — Hipertensi — Skor 75      │
└────────────────────────────────────────────────────────┘
```

- **Rute Web (`apps/web`)**:
  - `/login`: Form masuk nakes & admin (telepon/email + password) dengan tombol cepat demo hackathon.
  - `/dashboard`: Halaman utama monitoring nakes.
- **URL Query Param Sync (AC-5.2)**:
  - Format: `/dashboard?district=347101&disease=DIABETES&from=2026-08-01&to=2026-08-16&escalationStatus=FAMILY_TIER_1`
  - URL dapat di-bookmark dan dibagikan langsung. Saat di-refresh atau dibuka, input filter otomatis terisi dan API dipanggil sesuai query.
- **State Handling**:
  - *Loading State*: Skeleton placeholder beranimasi pulse.
  - *Error State*: Pesan error jelas dan tombol "Coba Lagi".
  - *Empty State*: Informasi ramah saat data nihil.


### 5.5 (C) Dashboard Nakes — Detail Alert Darurat

```
┌───────────────────────────────────────┐
│ Alerts > #e1  (EMERGENCY)              │
│                                        │
│ Pasien: Bu Ratna (72 th, ALONE)        │
│ Anomali HR 145 bpm · 02:01 WIB         │
│ [ 📍 Lihat Peta ] (lat, lng)           │
│                                        │
│ Timeline:                              │
│  02:01 anomali terdeteksi              │
│  02:01 konfirmasi pasien (30dtk)       │
│  02:02 timeout → alert Tier2 + Nakes   │
│  02:02 lokasi dikirim ke Ari           │
│                                        │
│ [ Saya Tangani ] [ Hubungi Pasien ]    │
└───────────────────────────────────────┘
```

### 5.6 (D) App Keluarga — Notifikasi List

```
┌──────────────────────────────┐
│ CareLoop                     │
│                              │
│ 🔴 Bu Ratna — DARURAT        │
│   12 menit lalu [Lihat]      │
│ 🟡 Bu Ratna belum minum obat │
│   08:30 hari ini [Lihat]     │
│ 🟢 Kepatuhan mingguan 100%   │
│   Senin lalu                 │
│ 🔔 Refill: Metformin hampir  │
│   habis (H-3) [Ambil obat]   │
└──────────────────────────────┘
```

### 5.7 (B) App Pasien — Skrining (1 layar)

```
Pertanyaan 1/4
"Dalam 3 bulan terakhir, apakah Anda
sering haus dan buang air kecil?"

  [ Ya ]  [ Tidak ]  [ Tidak yakin ]

Progress: ●●●○
```

- Skrining singkat (4–6 pertanyaan), satu per layar, tombol besar.

## 6. Design System

### 6.1 Warna

| Token | Hex | Penggunaan |
|---|---|---|
| `primary` | `#0E7490` (cyan-700) | Aksi utama, tautan, brand |
| `primary-dark` | `#155E75` | Hover/press |
| `success` | `#16A34A` (green-600) | Konfirmasi, "Sudah Minum", aman |
| `warning` | `#D97706` (amber-600) | Perhatian, tunda, mendekati timeout |
| `danger` | `#DC2626` (red-600) | Darurat, panggil 112, alert aktif |
| `background` | `#FAFAF9` | Layar terang (bukan putih murni — kurangi silau) |
| `surface` | `#FFFFFF` | Kartu |
| `text` | `#1C1917` (stone-900) | Teks utama |
| `text-muted` | `#57534E` (stone-600) | Teks sekunder (≥ 4.5:1 di background) |
| `text-on-primary` | `#FFFFFF` | Teks di atas primary |

> Dark mode: opsional, **tidak** menjadi prioritas MVP. Pastikan mode terang memenuhi AA.

### 6.2 Tipografi

| Level | Ukuran | Weight | Keterangan |
|---|---|---|---|
| Display | 28–32px | 700 | Halaman darurat |
| H1 | 24px | 700 | Judul layar |
| H2 | 20px | 600 | Judul kartu |
| Body | 18px | 400 | Konten utama (≥ 16px minimum) |
| Body-small | 16px | 400 | Metadata |
| Button | 20px | 700 | Label tombol |
| Peringatan | 20px | 800 | Teks alert darurat |

- Font: system stack + aksara Latin (interop dengan teks Indonesia). `font-family: ui-rounded, system-ui, -apple-system, sans-serif` untuk nuansa ramah. Hindari font script.

### 6.3 Spacing & Radius

- Grid: 4px base. Spacing: 4/8/12/16/24/32.
- Radius tombol: 12px (besar & mudah dikenali).
- Target sentuh: ≥ 48×48; tombol darurat ≥ 64×64.

### 6.4 Komponen

| Komponen | Spesifikasi |
|---|---|
| `PrimaryButton` | tinggi 56px, radius 12, bg `primary`, teks putih 20px bold, label aksi (VERB) |
| `DangerButton` | sama tapi bg `danger`; untuk aksi darurat |
| `SuccessButton` | bg `success`; konfirmasi "Saya aman"/"Sudah minum" |
| `Card` | surface, radius 16, shadow halus |
| `AlertBanner` | sticky top, bg `danger` 10% + border kiri `danger` |
| `ProgressBar` | timeout darurat; tinggi 12px; warna berubah green→amber→red |
| `ChipFilter` | filter dashboard (puskesmas, penyakit, tanggal) |
| `LineChart` / `BarChart` | Recharts, aksesibel (label, tooltip) |
| `Skeleton` | loading state halus (dashboard) |
| `WhatsAppButton` | mapping tombol WA → action id `CONFIRM_TAKEN_<scheduleId>` |
| `EmergencyCallButton` | `tel:112`, besar, tidak auto-dial |

### 6.5 Ikon

- Ikon garis tebal (24px stroke) + label teks. Gunakan ikon konsisten (Lucide/React Native vector icons). Ikon + teks selalu.

### 6.6 Bahasa & Tone

- Bahasa Indonesia sederhana, kalimat pendek, sapaan nama.
- Darurat: singkat & tegas — "Panggil 112 sekarang" (bukan "Anda dapat menghubungi layanan gawat darurat jika diperlukan").
- Hindari istilah klinis di permukaan; istilah medis di belakang layar / detail.

## 7. Pesan WhatsApp (Copy)

### Reminder
```
💊 Waktunya minum obat, {nama}!
{obat} — {dosis} — {catatan}
[Sudah Minum] [Tunda 15 menit]
```

### Konfirmasi darurat
```
⚠️ Deteksi detak jantung tinggi ({hr} bpm).
Apakah Anda aman, {nama}?
[Saya Aman] [Saya Butuh Bantuan]
```

### Alert keluarga (kepatuhan)
```
🟡 {nama} belum mengonfirmasi minum obat.
Jadwal: {waktu} ({obat}).
Mohon hubungi beliau.
[Saya Sudah Menghubungi] [Sudah Ditangani]
```

### Alert keluarga (darurat)
```
🚨 DARURAT — {nama}
Detak jantung tinggi terdeteksi.
Beliau tidak merespons konfirmasi.
Lokasi: {google_maps_link}
[Panggil 112] [Saya ke Lokasi] [Sudah Ditangani]
```

### Alert nakes (prioritas)
```
🚨 DARURAT PRIORITAS — pasien tinggal sendiri.
{nama} ({usia}th), {penyakit}.
Lokasi: {maps_link}
Status eskalasi: {tier}. Keluarga: {tersedia/tidak}.
[Saya Tangani] [Lihat Dashboard]
```

### Refill
```
🔔 Stok {obat} tinggal ± {sisa} hari.
Segera ambil obat ke faskes/apotek.
[Saya Sudah Ambil Obat]
```

### Edukasi (menu)
```
💡 Menu Edukasi — ketik angka:
1. Tentang diabetes
2. Tentang hipertensi
3. Cara minum obat yang benar
4. Kapan harus ke dokter
5. Kontak bantuan
```

## 8. Accessibility Checklist

- [ ] Semua teks ≥ 16px (kecuali label kecil dengan alternatif).
- [ ] Kontras AA terpenuhi (test: axe / Lighthouse).
- [ ] Semua tombol target ≥ 48px; darurat ≥ 64px.
- [ ] Aksi utama 1 tap; tidak ada navigasi wajib multi-level untuk aksi kritis.
- [ ] Tidak ada informasi berbasis warna saja (ikon + teks).
- [ ] Form skrining: satu pertanyaan per layar, tombol besar.
- [ ] Voice reminder tersedia untuk pasien `voice_enabled`.
- [ ] Teks alternatif untuk semua ikon & gambar.
- [ ] Fokus keyboard terlihat (dashboard nakes).
- [ ] Pesan WA singkat & jelas; darurat menggunakan kata "DARURAT".
- [ ] Uji dengan setidaknya 1–2 lansia (atau simulasikan) sebelum demo.
