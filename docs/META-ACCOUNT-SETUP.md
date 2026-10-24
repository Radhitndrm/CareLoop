# Panduan — Mendaftarkan CareLoop ke Meta (WhatsApp Cloud API)

Panduan ini untuk langkah yang **harus dikerjakan manual di portal Meta**. Tidak ada kode
yang bisa mengautomasi bagian ini, dan tidak seharusnya.

Butuh kira-kira **1–3 hari kalender**, hampir semuanya karena menunggu Meta — bukan
karena kerja teknis.

> Ikuti urutan di bawah. Urutannya tidak bisa dibalik: nomor harus terverifikasi
> sebelum WABA bisa dibuat, dan WABA harus ada sebelum template bisa diajukan.

---

## Yang perlu disiapkan sebelum mulai

- [ ] Akun Facebook ( pribadi, bukan bot)
- [ ] Data bisnis: nama, alamat, email, nomor telepon, dan **dokumen legal**
      (NIB/akta — Meta bisa meminta untuk verifikasi bisnis)
- [ ] **Satu nomor telepon** khusus untuk CareLoop. Jangan pakai nomor pribadi Anda —
      nomor ini akan jadi identitas bisnis dan tidak bisa dipindah dengan mudah.
- [ ] Kartu kredit/debit untuk metode pembayaran (wajib sejak 2024; tidak langsung
      ditagih, tapi tanpa itu nomor asli tidak bisa dipakai)
- [ ] Alokasi waktu: **ini bagian paling lambat dari seluruh proyek**

> 🇮🇩 Untuk konteks Indonesia: CareLoop memproses data kesehatan. Pertimbangkan
> `data_localization_region: "ID"` saat mendaftarkan nomor (lihat §4) agar data disimpan
> di wilayah Indonesia — relevan dengan UU PDP. Perhatikan juga bahwa WhatsApp Business
> Policy melarang mengirim informasi kesehatan lewat WA bila regulations melarang.

---

## 1. Business Portfolio (5 menit)

1. Buka <https://business.facebook.com> → **Business Settings**.
2. Buat **Business Portfolio** (dulu disebut Business Manager), isi data bisnis.
3. Catat **Business Portfolio ID** — dipakai di langkah System User nanti.

> Saat membuat app di langkah 2, Portfolio biasanya dibuat otomatis. Kalau sudah ada,
> pakai yang itu saja, jangan buat kedua.

---

## 2. Buat app & hubungkan ke WhatsApp (15 menit)

1. Buka <https://developers.facebook.com> → **My Apps** → **Create App**.
2. Tipe: **Business** (WA Cloud API tidak tersedia untuk tipe lain).
3. Pilih use case **"Other"**, lalu tambahkan produk **WhatsApp**.
4. Klik **Start using the API** → Anda masuk ke halaman **API Setup**.

Di halaman API Setup Anda akan melihat:

| Yang tampil | Arti | Catat |
|---|---|---|
| **Phone number ID** | Yang diisi ke `WHATSAPP_PHONE_ID` | Bukan nomor teleponnya |
| **WhatsApp Business Account ID** (WABA ID) | ID akun bisnis | Dipakai saat System User |
| **Test number** | Nomor milik Meta | Hanya untuk 5 penerima |
| **Temporary access token** | Token sementara | **Kedaluwarsa ±24 jam** |

> 💡 Ada **nomor uji coba** bawaan Meta yang bisa langsung dipakai. Itu cara tercepat
> untuk membuktikan provider CareLoop jalan sebelum Anda repot verifikasi nomor asli.

**Now try it:** isi nomor tujuan Anda sendiri → **Send message**. Kalau muncul di WA Anda,
provider-nya fundamentally benar. Kalau gagal, cek `WHATSAPP-API-VERSION` Anda.

---

## 3. Verifikasi nomor asli (⏳ 1–3 hari, bisa ditolak)

1. API Setup → **Add Phone Number**.
2. Masukkan nomor dengan format internasional: `+62 812…`
3. Pilih metode verifikasi, lalu masukkan kode.

> **Penting:** verifikasi dikirim lewat **WhatsApp, bukan SMS**. Nomor harus sudah aktif
> di WhatsApp dan harus bisa menerima pesan WhatsApp.

Kalau kode tidak sampai atau nomor ditolak:

- Nomor mungkin sudah terdaftar di WhatsApp **bukan** sebagai akun bisnis → klaim dulu
  lewat WhatsApp Manager.
- Nomor bisa ditolak karena riwayat atau reputasinya.
- **Jangan ulangi berulang-ulang.** Endpoint registrasi punya batas 10 percobaan per nomor
  per 72 jam; kena batas → error `133016` dan nomor **terkunci 72 jam**.

Setelah terverifikasi, nomor Anda muncul di dropdown **From**.

---

## 4. Daftarkan nomor lewat API (2 menit) — wajib

Sejak 2026, nomor tidak aktif hanya dengan diverifikasi; nomor juga harus
**di-registrasi** lewat endpoint `register`. Token yang dipakai butuh izin
`whatsapp_business_management` dan `whatsapp_business_messaging` (lihat §5).

```bash
curl -X POST "https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "messaging_product": "whatsapp",
    "pin": "123456",
    "data_localization_region": "ID"
  }'
```

| Field | Wajib | Keterangan |
|---|---|---|
| `messaging_product` | ✅ | Selalu `"whatsapp"` |
| `pin` | ✅ | PIN 2FA 6 digit. **Buat PIN baru** yang kuat, jangan reuse PIN lama |
| `data_localization_region` | ❌ | Kode negara ISO. **`ID` didukung** — pertimbangkan untuk data kesehatan |

> `data_localization_region` hanya bisa diubah dengan cara **deregister lalu register
> ulang**. Jadi pikirkan dulu sebelum memilih.

---

## 5. Token permanen (10 menit)

Token dari API Setup **kedaluwarsa dalam ~24 jam**. Untuk produksi:

1. Business Settings → **Users → System Users** → **+ Add**.
2. Beri nama, role **Admin** → Create.
3. **Assign Assets**:
   - Apps → pilih app Anda → **Full control**
   - WhatsApp Accounts → pilih WABA Anda → **Full control**
4. Kembali ke System User → **Generate new token**:
   - App: pilih app Anda
   - Expiration: **Never**
   - Permissions:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
     - `business_management`

> ⚠️ Token **hanya ditampilkan sekali**. Simpan di password manager. Jangan pernah
> masukkan ke repo, `.env.example`, atau screenshot.

Isi `.env` backend:

```env
PROVIDER_MODE=live
WHATSAPP_TOKEN=EAAG…
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_API_VERSION=v26.0
WHATSAPP_REMINDER_TEMPLATE=pengingat_obat
```

`env.ts` **menolak startup** kalau tiga credential pertama kosong.

---

## 6. Buat message template (1 jam + review)

Reminder obat bersifat **proaktif**, jadi berada di luar jendela layanan 24 jam Meta —
dan hanya boleh dikirim lewat template yang disetujui.

**WhatsApp Manager → Message Templates → Create**:

| Field | Isi |
|---|---|
| Nama | `pengingat_obat` |
| Kategori | **UTILITY** |
| Bahasa | `Indonesian (id)` |
| Body | `Halo {{1}}, waktunya minum {{2}} pukul {{3}}.` |
| Tombol | `Quick Reply` |
| Label tombol | `Sudah Minum` |
| **Payload quick reply** | `KONFIRMS` |

Kirim pengajuan, lalu tunggu status jadi **APPROVED**.

> Payload quick-reply ditetapkan saat template disetujui dan **tidak bisa diubah** —
> itu sebabnya memakai `KONFIRMS` (konstan) alih-alih id jadwal. Cara kerjanya
> dijelaskan di [WHATSAPP-SETUP.md §4](WHATSAPP-SETUP.md#4-pengingat-otomatis-memakai-template--sudah-diimplementasikan).

**Kenapa sering ditolak:** variabel tidak urut, kategori salah, atau bahasa tidak cocok
dengan template.

---

## 7. Metode pembayaran (2 menit)

API Setup → **Add Payment Method**. Kartu wajib ada sebelum nomor asli bisa dipakai
beyond test sandbox.

---

## 8. Webhook (menunggu URL publik)

Baru setelah langkah 1–7 selesai.

| Field | Isi |
|---|---|
| Callback URL | `https://<domain-anda>/webhooks/whatsapp` |
| Verify token | nilai `WA_WEBHOOK_VERIFY_TOKEN` (pilih sendiri) |
| Field subscribe | **`messages`** |

Untuk mencoba tanpa deploy, pakai **Cloudflare Tunnel** atau **ngrok** — dapat URL HTTPS
dalam semenit.

> Webhook **tidak wajib** untuk bisa mengirim pesan. Yang butuh webhook hanya membaca
> balasan tombol dari pasien.

---

## Checklist akhir

Sebelum menganggap selesai, pastikan:

- [ ] `GET /{WABA_ID}/phone_numbers` mengembalikan status nomor `CONNECTED`
- [ ] Pesan uji benar-benar sampai ke WhatsApp Anda
- [ ] Template `pengingat_obat` berstatus **APPROVED**
- [ ] Reminder berjalan: jadwal aktif, resep `APPROVED`, pasien `ACTIVE`
- [ ] Webhook terverifikasi (balas `POST /webhooks/whatsapp` → `200`)
- [ ] Membalas "Sudah Minum" di WhatsApp sungguhan → `compliance_logs` bertambah
- [ ] Token tidak ada di dalam repo

---

## Kalau tersendat

| Gejala | Penyebab | Solusi |
|---|---|---|
| Token berhenti setelah ~1 hari | Masih pakai token sementara | Buat System User token (§5) |
| `(#131047) Re-engagement message` | Di luar jendela 24 jam | Kirim lewat template |
| `133016` | Lebih dari 10x registrasi dalam 72 jam | Tunggu 72 jam, jangan ulangi |
| `unknown version` | Graph API versi lama | Naikkan `WHATSAPP_API_VERSION` |
| Pesan uji terkirim tapi webhook sunyi | Field `messages` belum disubscribe | Cek konfigurasi webhook |
| Template ditolak | Variabel/kategori/bahasa tidak sesuai | Perbaiki lalu ajukan ulang |

---

## Sumber

- Cloud API Get Started — <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>
- Register business phone number — <https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration>
- Message templates — <https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/>
- Business Policy — <https://whatsappbusiness.com/policy/>

Dokumen Meta berubah cepat. Kalau ada langkah yang tidak cocok dengan yang Anda lihat di
layar, dokumentasi resmi di atas yang lebih akurat.