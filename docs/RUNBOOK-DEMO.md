# Runbook — Demo WhatsApp CareLoop

Panduan operator untuk menjalankan simulasi WhatsApp saat presentasi. Semua yang ditulis di
sini memakai **data sintetis** dan **tidak pernah** mengirim pesan ke nomor nyata.

Rencana & spesifikasi lengkap: [`tasks/plan-whatsapp-mockup-demo.md`](../tasks/plan-whatsapp-mockup-demo.md).

---

## 1. Sebelum presentasi (sekali saja, ~5 menit)

```bash
# 1. Database + Redis
docker compose -f infra/docker-compose.yml up -d

# 2. Konfigurasi demo — pastikan nilai ini benar
#    NODE_ENV=development
#    PROVIDER_MODE=mock          # tidak pernah memanggil Meta
#    SIMULATOR_ENABLED=true      # menyalakan /v1/dev/whatsapp/*
#    WHATSAPP_TOKEN=             # kosongkan: tidak ada kredensial live di repo

# 3. Migrasi + seed persona sintetis
cd apps/api
npm run db:migrate
npm run db:seed

# 4. Jalankan API + web
npm run dev            # apps/api
npm run dev            # apps/web (terminal lain)
```

Login memakai akun demo hasil seed (lihat `prisma/personas.ts`):
`dr. Dewi Lestari` / `081100000001`, kata sandi `CareLoop#Demo2026`.

---

## 2. Membuka panel

1. Login di web dashboard.
2. Buka menu **Sistem → Simulator** (menu ini hanya muncul di build non-production).
3. Klik **Reset simulasi** lalu konfirmasi — ini mengembalikan fixture demo ke kondisi awal.
   Aman diulang dan hanya menyentuh baris milik dua persona demo.

Persona yang dipakai scenario:

| Persona | Peran | Skenario |
|---|---|---|
| Pak Haji (Amlodipine 5 mg, 07:00) | pasien + keluarga Sari (tier 1) | A & B |
| Bu Ratna (smartwatch aktif, ALONE) | pasien, eskalasi langsung ke nakes | C |

---

## 3. Menjalankan scenario

### Scenario A — Reminder → "Sudah Minum" (target ≤ 2 menit)

1. Klik **A · Reminder → Sudah Minum**.
2. Pesan keluar muncul di percakapan Pak Haji.
3. Tekan **Sudah Minum**.
4. Buka tab **Pasien → Pak Haji**; status kepatuhan berubah dan eskalasi tertutup.

Kalau statusnya `CONFIRMED_LATE` (bukan `CONFIRMED`), itu **benar**: demo dijalankan di luar
jendela 30 menit jadwal 07:00, dan sistem tetap menghitungnya sebagai diminum (AC-2.3).
Kalau ingin melihat `CONFIRMED` penuh, jalankan skenario sekitar jam jadwal.

### Scenario B — Tidak merespons → eskalasi keluarga (target ≤ 3 menit)

1. Klik **A · Reminder → Sudah Minum** (membuat run eskalasi).
2. Klik **B · Tidak merespons → eskalasi**.
3. Percakapan keluarga Sari muncul dengan tombol **Saya Tangani** dan tombol 112.
4. Tekan **Saya Tangani** → run berubah `HANDLED`.

Timeout produksi **tidak diubah**: yang dipendekkan hanya kapan tombol ditekan.

### Scenario C — Anomali denyut jantung (tanpa perangkat keras)

1. Klik **C · Anomali denyut jantung**.
2. Pasien Bu Ratna menerima "Apakah Anda aman?" dengan dua tombol.
3. Tekan **Saya Butuh Bantuan** → eskalasi lanjutan ke nakes.
   (Tekan **Saya Aman** kalau ingin menunjukkan emergency ditutup tanpa alert.)

Tombol **Hubungi 112** adalah deep-link `tel:112`. Panggilan tetap ditekan manual oleh manusia;
backend tidak pernah memulai panggilan.

### Scenario D — Gagal kirim → retry

1. Klik **Simulasikan kegagalan provider**.
2. Klik **A · Reminder → Sudah Minum** → badge **Gagal** muncul di percakapan.
3. Matikan **Simulasikan kegagalan provider**.
4. Klik **A · Reminder → Sudah Minum** lagi → terkirim, tanpa pengiriman ganda.

---

## 4. Kalau ada gangguan

| Gejala | Yang dilakukan |
|---|---|
| Menu **Simulator** tidak ada | Halaman dibangun dengan `NODE_ENV=production`. Jalankan `next dev`. |
| Panel menulis "Simulator tidak aktif di instance ini" | Backend jalan dengan `SIMULATOR_ENABLED=false`, atau tidak jalan sama sekali. |
| Halaman 404 saat scenario ditekan | ID scenario tidak dikenal, atau service-nya menolak (mis. "Belum ada run eskalasi aktif" — jalankan A dulu). |
| Tombol mati | Pesan sudah dibalas, atau pengirimnya gagal terkirim. Tekan **Muat ulang**. |
| Ingin mengulang dari awal | **Reset simulasi** (butuh konfirmasi). |

**Selalu siapkan screen recording sebagai cadangan** — demo tidak boleh bergantung pada
ketersediaan jaringan atau database saat presentasi.

---

## 5. Batas yang tidak boleh dilanggar

- **Jangan** mengubah `PROVIDER_MODE=live` atau mengisi kredensial WhatsApp Meta.
- **Jangan** mengganti nomor fixture dengan nomor asli. Selalu `08xxxxxxxxxx`.
- **Jangan** menyimpan kredensial demo di dalam repo.
- Sesudah demo, biarkan `PROVIDER_MODE=mock` dan `SIMULATOR_ENABLED` tetap apa adanya.