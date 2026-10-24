# Panduan — Mengaktifkan WhatsApp Sungguhan (Meta Cloud API)

Kode provider sudah lengkap dan teruji
(`apps/api/src/integrations/whatsapp/providers/meta.provider.ts`). Yang belum ada
adalah **akun Meta dan token**-nya — itu tidak bisa dibuat oleh kode.

Baca **Bagian 0 dulu**. Ada dua aturan Meta yang bisa membuat integrasi ini gagal
diam-diam.

---

## 0. Dua aturan Meta yang harus dipahami lebih dulu

### 0.1 Jendela layanan 24 jam ⏰

Meta hanya mengizinkan pesan *free-form* dalam **24 jam sejak pengguna terakhir
mengirim pesan ke bot**. Di luar itu, **hanya template yang sudah disetujui Meta**
yang boleh dikirim.

| Jenis pesan | Di dalam jendela | Di luar jendela |
|---|---|---|
| Teks biasa (TEXT) | ✅ | ❌ |
| Tombol interaktif (INTERACTIVE) | ✅ | ❌ |
| Media | ✅ | ❌ |
| **Template (TEMPLATE)** | ✅ | ✅ |

**Konsekuensi untuk CareLoop:** reminder obat terjadwal (pukul 07:00) itu **proaktif** —
pasien belum pernah menyapa bot. Jadi **selalu di luar jendela** dan **wajib pakai
template**. Tanpa template, pengiriman ditolak dengan kode `131047` dan **pasien tidak
pernah menerima pengingatnya** — sementara sistem mencatatnya sukses kalau error-nya
tidak dibaca.

Yang justru tetap jalan: **balasan tombol**. Begitu pasien menekan "Sudah Minum", jendela
terbuka 24 jam ke depan, jadi balasan lanjutan (konfirmasi, tunda, "Saya Tangani")
bebas tanpa template.

> Provider sudah memetakan `131047` sebagai kegagalan **permanen** (`retryable: false`)
> dengan pesan yang menjelaskan soal template — supaya retry tidakJWBQ menyamar jadi
> "gagal sesaat".

### 0.2 Data kesehatan ⚠️

WhatsApp Business Policy berbunyi:

> *"Don't use WhatsApp for telemedicine or to send or request any health related
> information, if applicable regulations prohibit distribution of such information to
> systems that do not meet heightened requirements to handle health related information."*

CareLoop mengirim **nama obat + nama pasien + kondisi** lewat WhatsApp. Secara teknis
Secara teknis bukan halangan besar (banyak bisnis kesehatan memakai WhatsApp), tapi ini
**risiko kebijakan, bukan teknis** — akun bisa dibatasi atau dibekukan. Pertimbangkan
sebelum mengaktifkan kode ini di produksi.

---

## 1. Membuat akun Meta (manual, ~1–3 hari)

> Panduan langkah demi langkah ada di **[META-ACCOUNT-SETUP.md](META-ACCOUNT-SETUP.md)** —
> termasuk registrasi nomor via API dan `data_localization_region`.

1. Buka [developers.facebook.com](https://developers.facebook.com) → buat app tipe
   **Business**.
2. Tambah produk **WhatsApp**.
3. Di WhatsApp → **API Setup**:
   -Token sementara tersedia untuk mencoba (berumur 24 jam).
   - Nomor telepon tujuan harus **terverifikasi** lewat kode OTP yang dikirim WhatsApp
     (bukan SMS). Nomor harus mendukung voice call sebagai cadangan.
4. Buat **message template** untuk pengingat terjadwal (detail + tombol di §4.1).
   Status harus **APPROVED** sebelum dipakai.

> Verifikasi nomor sering butuh beberapa hari dan bisa ditolak. **Ajukan ini lebih
> awal** — ini bagian yang paling sering menjadwalkan proyek, bukan koding.

---

## 2. Token permanen (System User)

Token sementara kedaluwarsa. Untuk produksi:

1. Business Settings → **Users → System Users** → buat system user.
2. Kasih aset: WhatsApp Business Account + Phone Number, dengan izin
   `whatsapp_business_messaging`.
3. Generate token → **simpan di password manager**, bukan di repo.

Isi `.env`:

```env
PROVIDER_MODE=live
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_API_VERSION=v21.0
WHATSAPP_REMINDER_TEMPLATE=pengingat_obat
```

`env.ts` **menolak startup** kalau `PROVIDER_MODE=live` tanpa tiga credential itu.

---

## 3. Webhook

Webhook butuh **URL publik HTTPS**. Dari Fastify:

```
POST https://<domain-anda>/webhooks/whatsapp
```

Di Meta → WhatsApp → Configuration:

| Field | Isi |
|---|---|
| Callback URL | `https://<domain-anda>/webhooks/whatsapp` |
| Verify token | nilai `WA_WEBHOOK_VERIFY_TOKEN` |
| Field subscribe | **`messages`** |

Backend membalas handshake `hub.challenge`, lalu memverifikasi signature tiap request
lewat `X-Hub-Signature-256` (HMAC-SHA256 dengan `WA_APP_SECRET`).

Untuk mencoba tanpa domain, gunakan tunneling (ngrok / Cloudflare Tunnel) yang
memberi URL HTTPS sementara.

---

## 4. Pengingat otomatis memakai template — sudah diimplementasikan

`reminder.worker.ts` sudah menanganinya otomatis. Tidak ada kode yang perlu Anda ubah —
cukup sediakan template yang disetujui Meta. Alurnya:

```text
coba kirim INTERACTIVE (tombol "Sudah Minum")
   ├─ berhasil          → selesai, seperti sekarang
   └─ Meta jawab 131047 → otomatis kirim TEMPLATE + tombol quick-reply
```

Nama template dibaca dari `WHATSAPP_REMINDER_TEMPLATE` (default `pengingat_obat`).

Perbedaan perilaku per mode:

| Skenario | Yang dikirim | Tombol yang muncul |
|---|---|---|
| Mode mock (demo) | INTERACTIVE | "Sudah Minum" + "Tunda 15 menit" |
| Live, di dalam jendela 24 jam | INTERACTIVE | keduanya |
| Live, di luar jendela 24 jam | **TEMPLATE** | **"Sudah Minum"** (quick-reply) |

`reminder_logs.error` berisi catatan *"dikirim sebagai message template (jendela 24 jam
tertutup)"* supaya jejak audit tidak mengklaim terkirim lewat kanal yang salah.

### 4.1 Template yang harus dibuat di Meta

| Field | Isi |
|---|---|
| Nama | `pengingat_obat` |
| Kategori | `UTILITY` |
| Bahasa | `Indonesian (id)` |
| Body | `Halo {{1}}, waktunya minum {{2}} pukul {{3}}.` |
| Tombol | `Quick Reply` |
| Label tombol | `Sudah Minum` |
| Payload quick reply | `KONFIRMS` |

> **Payload quick-reply bersifat tetap** — ditetapkan saat template disetujui dan tidak
> bisa diubah per jadwal. CareLoop menyelesaikannya dengan payload konstan `KONFIRMS`:

```text
pengingat terjadwal (di luar jendela 24 jam)
  → TEMPLATE "pengingat_obat" + quick-reply ber-payload KONFIRMS
pasien mengetuk "Sudah Minum"
  → Meta mengirim button_reply: id=KONFIRMS, context.id=<id pesan template>
  → jendela 24 jam TERBUKA (pasien yang mengetik)
  → CareLoop mengirim pesan lanjutan BERTOMBOL sungguhan:
      CONFIRM_TAKEN_<scheduleId>  "Sudah Minum"
      DEFER_<scheduleId>         "Tunda 15 menit"
pasien mengetuk tombol itu
  → dispatchWaIntent → confirmMedicationIntake (jalur yang sama dengan mode mock)
```

Jadi **satu template cukup untuk semua jadwal**, dan tombol yang benar-benar dilihat pasien
tetap `CONFIRM_TAKEN_<scheduleId>`.

Pemetaan `KONFIRMS` → jadwal memakai `interactive.context.id`, yaitu id pesan yang
dijawab, yang dicocokkan ke `reminder_logs.provider_message_id`.

Kalau lebih suka cara sederhana, set `WHATSAPP_REMINDER_TEMPLATE_BUTTON=CONFIRM_TAKEN`
agar template memakai `CONFIRM_TAKEN_<scheduleId>` secara langsung — tapi itu butuh satu
template berbeda per jadwal.

### 4.2 Apa yang terjadi setelah tombol asli ditekan

Tidak ada jalur baru — identik dengan mode mock:

```text
pasien tap "Sudah Minum" pada pesan lanjutan
  → Meta mengirim button_reply payload CONFIRM_TAKEN_<scheduleId>
  → POST /webhooks/whatsapp
  → parseButtonReply → intent CONFIRM_TAKEN + scheduleId
  → dispatchWaIntent → confirmMedicationIntake
  → compliance_logs CONFIRMED + eskalasi ditutup
```

Pengiriman ulang `KONFIRMS` oleh Meta tidak mengirim ulang tombol: penanda dikirimnya
tombol disimpan per pesan template (`messageKey = reminder.confirm_buttons:<context.id>`),
jadi slot harian berikutnya tetap mendapat tombolnya sendiri.

---

## 5. Menguji cepat

```bash
# health check
curl localhost:4000/healthz

# kirim pesan uji ke nomor Anda sendiri (yang sudah terverifikasi)
curl -X POST localhost:4000/v1/dev/whatsapp/messages \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"to":"628120000001","text":"Halo dari CareLoop"}'
```

Atau lewat panel: **http://localhost:3000/simulator** — tapi panel itu memakai
`MockWhatsAppProvider`, **bukan** Meta. Untuk menguji Meta sungguhan, panggil
service-nya langsung lewat skrip:

```ts
import { getWhatsAppService } from './src/integrations/whatsapp/whatsapp.service'

const wa = getWhatsAppService()
console.log('provider:', wa.provider.name) // harus 'meta-cloud-api'

await wa.sendText('628xxxxxxxxx', 'Halo, ini uji coba CareLoop')
```

Kalau muncul `131047`, artinya jendela 24 jam belum terbuka — **itulah yang terjadi
untuk nomor yang belum pernah menyapa bot**.

---

## 6. Kalau gagal

| Gejala | Penyebab | Solusi |
|---|---|---|
| `131047` | Di luar jendela 24 jam | Pakai template, atau minta patient balas dulu |
| `131026` / `131009` | Nomor tidak bisa dikirimi | Nomor belum pernah chat bot, atau memblokir |
| `190` / `401` | Token salah/kedaluwarsa | Generate ulang System User token |
| `(#4)` / `429` | Rate limit | Sudah otomatis di-retry (maks 3x) |
| HTTP 200 tapi tidak sampai | `messages[0].status === 'failed'` | Provider sudah melempar error di kasus ini — cek `reminder_logs` |
| `WHATSAPP_API_VERSION` ditolak | Format bukan `v21.0` | Ikuti pola `v<major>.<minor>` |

---

## 7. Yang belum dikerjakan

- **Upload media** — audio memakai `link` publik. Voice note asli butuh Resumable
  Upload API (belum ada).
- **Status delivery/read** — `NotificationStatus.DELIVERED/READ` belum ada writer-nya.
  Butuh parses payload `statuses[]` dari webhook.
- **Template create/manage** — template masih dibuat manual lewat dashboard Meta.