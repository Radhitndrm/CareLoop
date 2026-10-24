# Plan — WhatsApp Mockup untuk Presentasi

## Tujuan

Menyiapkan simulasi WhatsApp yang dapat dipakai saat presentasi CareLoop tanpa
Meta WhatsApp Cloud API, nomor telepon nyata, biaya pesan, atau koneksi webhook
publik.

Mockup harus tetap menjalankan flow bisnis yang sama dengan kanal WhatsApp:

```text
Trigger reminder
  → WhatsAppService
  → MockWhatsAppProvider
  → pesan muncul di WhatsApp Simulator
  → presenter memilih tombol balasan
  → API memproses intent
  → compliance / emergency / escalation berubah
  → dashboard ikut diperbarui
```

Mockup bukan sekadar teks statis. Nilai demo harus terlihat dari perubahan state
backend dan dashboard setelah tombol balasan dipilih.

## Prinsip dan batasan

- Gunakan hanya `MockWhatsAppProvider` dengan `PROVIDER_MODE=mock`.
- Jangan melakukan request ke Meta WhatsApp Cloud API.
- Jangan mengirim pesan ke nomor pasien, keluarga, atau nakes sungguhan.
- Gunakan data demo sintetis dan nomor dengan format `08xxxxxxxxxx`.
- Jangan menambahkan auto-dial 112. Tombol `Hubungi 112` hanya simulasi manual
  dan tidak boleh memulai panggilan dari backend.
- Jangan membuat mockup melewati RBAC, validasi ownership, approval resep, atau
  state machine eskalasi.
- Mockup harus dapat di-reset sebelum presentasi.
- Semua timestamp backend tetap UTC; tampilan demo dapat menampilkan WIB.
- Implementasi live Meta tetap menjadi pekerjaan terpisah dan tidak boleh
  diperlukan agar demo mockup berhasil.

## Target hasil

Pada akhir plan, presenter dapat menunjukkan tiga alur:

1. reminder obat → pasien menekan `Sudah Minum` → compliance terkonfirmasi;
2. reminder obat → pasien tidak merespons → keluarga/nakes menerima eskalasi;
3. anomali smartwatch → konfirmasi darurat → alert keluarga/nakes dan tombol
   tindakan manual.

Setiap alur harus dapat dijalankan kurang dari lima menit dan tidak bergantung
   pada timeout production yang panjang.

---

## Fase 0 — Audit fondasi yang sudah ada

### Tujuan

Memastikan mock provider dan domain service dapat dipakai sebagai dasar simulasi
tanpa membuat implementasi kedua yang berbeda dari aplikasi sebenarnya.

### Pemeriksaan

- [ ] `PROVIDER_MODE=mock` menjadi konfigurasi demo yang eksplisit.
- [ ] [whatsapp.service.ts](../apps/api/src/integrations/whatsapp/whatsapp.service.ts)
      memilih mock provider untuk environment demo.
- [ ] `sendText`, `sendTemplate`, dan `sendInteractive` menyimpan pesan yang
      dikirim beserta nomor tujuan dan waktu.
- [ ] Pesan yang tersimpan dapat dibaca oleh simulator tanpa mengubah data
      produksi.
- [ ] `reminder.worker.ts` memanggil `WhatsAppService`, bukan provider langsung.
- [ ] Reminder hanya dikirim bila pasien `ACTIVE`, resep `APPROVED`, dan jadwal
      aktif.
- [ ] Tombol memakai identifier yang dapat dikaitkan kembali ke resource
      (`scheduleId`, `emergencyId`, atau `escalationRunId`).
- [ ] Webhook/parser dan service domain yang sudah ada dipetakan sebelum UI
      simulator dibuat.

### Output

- daftar endpoint/service yang dipakai simulator;
- daftar intent tombol yang didukung;
- daftar gap wiring yang harus ditutup sebelum demo;
- fixture demo sintetis yang diperlukan.

---

## Fase 1 — Kontrak pesan mock

### Tujuan

Membuat bentuk data internal yang konsisten untuk menampilkan pesan WhatsApp
dan memproses balasan presenter.

### Data pesan minimal

Simulator perlu menampilkan:

```text
messageId
providerMessageId
to
recipientLabel
direction
kind
body
buttons
templateName
status
createdAt
relatedResource
```

Nilai `direction` minimal:

- `OUTBOUND` — pesan dari CareLoop ke pasien/keluarga/nakes;
- `INBOUND` — balasan simulasi dari penerima.

Nilai `status` minimal:

- `SENT`;
- `DELIVERED` — simulasi berhasil diterima;
- `READ` — simulasi sudah dibuka;
- `FAILED` — simulasi kegagalan pengiriman.

### Aturan kontrak

- `providerMessageId` tidak boleh kosong untuk pesan mock yang berhasil dikirim.
- `messageId` harus stabil untuk keperluan idempotency.
- Tombol menampilkan label pengguna dan menyimpan `id` intent secara terpisah.
- Simulator tidak boleh menerima identifier resource bebas dari input pengguna
  tanpa validasi server.
- Data message simulator boleh menggunakan penyimpanan in-memory untuk demo,
  tetapi hasil state bisnis tetap harus disimpan melalui service/domain yang
  sebenarnya.

### Output

- tipe data/DTO pesan mock;
- mapping status dan direction;
- mapping tombol ke intent bisnis;
- keputusan penyimpanan: in-memory untuk panel demo atau endpoint read-only
  berbasis data log yang sudah ada.

---

## Fase 2 — Panel WhatsApp Simulator

### Tujuan

Menyediakan tampilan yang mudah dipahami juri dan presenter.

### Tampilan utama

Panel harus memiliki:

- daftar percakapan berdasarkan penerima;
- label penerima sintetis;
- daftar pesan terbaru;
- timestamp;
- badge status pengiriman;
- tombol interaktif yang sama dengan pesan;
- indikator pesan outbound dan inbound;
- tombol refresh atau update realtime;
- tombol reset simulasi yang dilindungi konfirmasi.

Contoh tampilan:

```text
WhatsApp Simulator

Penerima: Bu Siti Test — 08xxxxxxxxxx
Status: ACTIVE

CareLoop · 08:00 WIB
Waktunya minum Amlodipine 5 mg.

[Sudah Minum] [Tunda 15 Menit]
```

Setelah presenter memilih `Sudah Minum`, simulator menampilkan:

```text
Bu Siti Test · 08:01 WIB
Sudah Minum

CareLoop · 08:01 WIB
Terima kasih. Konfirmasi minum obat sudah tercatat.
```

### Perilaku UI

- Tombol hanya aktif untuk pesan yang belum dijawab.
- Setelah reply berhasil, tombol dinonaktifkan dan intent tidak dapat dikirim
  dua kali sebagai event baru.
- Jika API mengembalikan error, simulator menampilkan error yang jelas dan
  menyediakan retry; jangan menampilkan sukses palsu.
- Panel menampilkan status loading saat memproses reply.
- Perubahan compliance, emergency, dan escalation dapat dibuka dari link ke
  dashboard terkait.

### Output

- halaman/komponen simulator;
- empty state;
- loading state;
- error state;
- reset state;
- responsive layout untuk layar presentasi.

---

## Fase 3 — Endpoint simulasi yang aman

### Tujuan

Menghubungkan simulator ke backend tanpa menjadikan mock endpoint sebagai jalur
produksi yang tidak terlindungi.

### Endpoint yang diperlukan

Nama endpoint mengikuti pola API yang sudah ada dan harus dikonfirmasi terhadap
route aktual sebelum implementasi:

```text
GET  /v1/dev/whatsapp/messages
POST /v1/dev/whatsapp/messages/:messageId/reply
POST /v1/dev/whatsapp/scenarios/:scenario/reset
POST /v1/dev/whatsapp/scenarios/:scenario/trigger
```

Alternatif yang lebih kecil adalah memakai endpoint domain yang sudah tersedia
dan hanya menambahkan endpoint read-only untuk mengambil pesan mock.

### Guard wajib

- Semua endpoint simulator memakai token autentikasi.
- Endpoint `dev` hanya aktif pada `NODE_ENV=development` atau environment demo
  yang eksplisit.
- Endpoint simulator tidak boleh aktif di production.
- Hanya user demo yang memiliki role yang sesuai yang dapat memicu scenario.
- Payload divalidasi dengan schema zod.
- `reply` memeriksa bahwa tombol berasal dari pesan yang benar dan resource
  berada dalam scope user.
- Reset hanya menghapus fixture demo yang ditandai khusus, bukan seluruh database.

### Output

- route dan schema validasi;
- guard environment;
- audit log untuk trigger, reply, dan reset;
- response shape konsisten `{ data, meta? }` atau `{ error: ... }`.

---

## Fase 4 — Wiring intent ke domain service

### Tujuan

Memastikan reply dari simulator menghasilkan perubahan bisnis yang sama seperti
reply WhatsApp nyata.

### Intent reminder

```text
CONFIRM_TAKEN
  → confirmMedicationIntake(...)
  → compliance log CONFIRMED
  → escalation aktif diselesaikan/dibatalkan sesuai aturan
  → dashboard diperbarui

DEFER
  → defer compliance melalui service resmi
  → jadwal tunda dibuat sesuai konfigurasi
  → tidak membuat reminder duplikat
```

### Intent emergency

```text
SAFE
  → handlePatientEmergencyResponse(...)
  → emergency ditandai resolved/aman
  → escalation lanjutan dihentikan sesuai state machine

NEED_HELP
  → handlePatientEmergencyResponse(...)
  → alert keluarga/nakes dibuat
  → tombol tindakan manual tetap tersedia
```

### Intent escalation

```text
HANDLE
  → service escalation resmi
  → run ditandai ditangani atau berpindah state sesuai aturan
  → audit log dibuat
```

### Aturan penting

- Jangan mengubah status langsung dari UI.
- Jangan membuat cabang bisnis khusus simulator.
- Gunakan service yang sama dengan webhook production.
- Terapkan idempotency bila reply yang sama dikirim dua kali.
- Tolak reply dari penerima yang tidak sesuai dengan resource.
- Tampilkan error domain apa adanya secara aman dan terlokalisasi pada UI.

### Output

- wiring intent end-to-end;
- test untuk setiap intent;
- test idempotency;
- test unauthorized/out-of-scope reply.

---

## Fase 5 — Scenario runner untuk presentasi

### Tujuan

Menyediakan tombol pemicu yang cepat tanpa menunggu scheduler production.

### Scenario A — Reminder berhasil dikonfirmasi

Prasyarat:

- pasien `Bu Siti Test` berstatus `ACTIVE`;
- resep sintetis berstatus `APPROVED`;
- schedule aktif;
- nomor tujuan sintetis.

Langkah:

1. klik `Trigger reminder`;
2. pastikan pesan outbound muncul;
3. klik `Sudah Minum`;
4. tampilkan pesan inbound;
5. buka dashboard compliance;
6. pastikan status `CONFIRMED`;
7. pastikan tidak ada eskalasi aktif untuk reminder tersebut.

### Scenario B — Tidak ada respons dan terjadi eskalasi

Langkah:

1. klik `Trigger reminder`;
2. pilih `Simulasikan tidak merespons`;
3. gunakan timeout demo yang singkat, misalnya 5–10 detik;
4. pastikan state berpindah ke tier keluarga;
5. tampilkan pesan outbound ke kontak keluarga sintetis;
6. pilih `Saya Tangani`;
7. pastikan state dan dashboard berubah sesuai state machine.

Timeout demo hanya override pada environment demo. Nilai production tetap
berasal dari konfigurasi environment dan tidak boleh diubah oleh UI umum.

### Scenario C — Emergency dari smartwatch

Langkah:

1. klik `Trigger heart-rate anomaly`;
2. pastikan emergency alert dibuat;
3. tampilkan prompt konfirmasi pasien;
4. pilih `Saya Butuh Bantuan`;
5. pastikan keluarga/nakes menerima alert mock;
6. tampilkan tombol `Hubungi 112`;
7. jelaskan bahwa panggilan tetap manual dan tidak dimulai oleh backend.

### Scenario D — Failure dan retry

Langkah:

1. aktifkan `Simulate provider failure`;
2. trigger reminder;
3. tampilkan status `FAILED` atau retry sesuai kontrak;
4. matikan failure;
5. klik retry;
6. pastikan pesan berhasil dan tidak terjadi double-send.

### Output

- scenario trigger;
- demo timeout configuration;
- reset per scenario;
- fixture yang selalu menghasilkan outcome deterministik.

---

## Fase 6 — Fixture dan reset demo

### Data sintetis

Gunakan data yang jelas merupakan data demo:

| Entitas | Nilai demo |
|---|---|
| Pasien | Bu Siti Test |
| Nomor pasien | 08xxxxxxxxxx |
| Kontak keluarga | Keluarga Test |
| Nomor keluarga | 08xxxxxxxxxx |
| Nakes | Dr. Andi Demo |
| Puskesmas | Puskesmas Demo CareLoop |
| Obat | Amlodipine 5 mg |
| Jadwal | Pagi — data sintetis |

Nomor dapat dibedakan per fixture, tetapi tidak boleh menggunakan nomor
pribadi/riil.

### Reset

Reset scenario harus:

- menghapus message mock terkait scenario;
- menutup compliance/escalation/emergency demo terkait;
- mengembalikan pasien dan resep ke state awal fixture;
- menghapus job demo yang tertinggal;
- tidak menghapus akun atau data di luar namespace demo;
- dapat dijalankan sebelum setiap rehearsal.

### Output

- seed/fixture demo idempoten;
- perintah reset;
- dokumentasi urutan reset → seed → trigger;
- verifikasi bahwa reset tidak menyentuh data non-demo.

---

## Fase 7 — Test dan rehearsal

### Test backend

- [ ] pesan text, template, dan interactive tersimpan pada mock provider;
- [ ] reminder hanya terkirim untuk pasien dan resep yang memenuhi guard;
- [ ] reply `CONFIRM_TAKEN` mengubah compliance;
- [ ] reply `DEFER` membuat penundaan yang benar;
- [ ] reply `SAFE` menyelesaikan emergency sesuai aturan;
- [ ] reply `NEED_HELP` memicu alert;
- [ ] reply `HANDLE` memproses escalation;
- [ ] reply ganda idempoten;
- [ ] reply dari nomor/resource yang salah ditolak;
- [ ] simulator tidak dapat dipanggil pada production;
- [ ] reset hanya memengaruhi fixture demo.

### Test UI

- [ ] pesan outbound dan inbound mudah dibedakan;
- [ ] tombol berubah disabled setelah reply sukses;
- [ ] loading/error state terlihat;
- [ ] status dashboard berubah setelah reply;
- [ ] panel terbaca pada resolusi layar presentasi;
- [ ] refresh tidak menggandakan pesan;
- [ ] reset meminta konfirmasi.

### Rehearsal presentasi

- [ ] skenario A selesai maksimal 2 menit;
- [ ] skenario B selesai maksimal 3 menit;
- [ ] skenario C dapat dipicu tanpa hardware smartwatch;
- [ ] API, database, Redis, dan web sudah hidup sebelum presentasi;
- [ ] ada backup screen recording atau screenshot;
- [ ] presenter memiliki akun demo dan kredensial tersimpan di luar repository;
- [ ] tidak ada secret di `.env.example`, fixture, log, atau screenshot.

---

## Definition of Done

- [ ] WhatsApp Simulator menampilkan pesan dari `MockWhatsAppProvider`.
- [ ] Minimal scenario reminder berhasil dan escalation gagal sudah berjalan.
- [ ] Minimal satu scenario emergency dapat dipicu.
- [ ] Reply simulator memakai service bisnis resmi, bukan update database langsung.
- [ ] Idempotency dan authorization diuji.
- [ ] Semua data demo sintetis.
- [ ] Tidak ada request ke Meta atau nomor nyata.
- [ ] Endpoint dev terlindungi dan dinonaktifkan di production.
- [ ] `npm run typecheck` lulus.
- [ ] `npm run lint` lulus.
- [ ] Test terarah untuk mock provider, simulator, dan intent lulus.
- [ ] Runbook presentasi tersedia untuk presenter.

## Runbook singkat presenter

```text
1. Pastikan NODE_ENV demo dan PROVIDER_MODE=mock.
2. Jalankan database + Redis.
3. Jalankan seed/reset fixture demo.
4. Login sebagai akun demo.
5. Buka dashboard dan WhatsApp Simulator.
6. Jalankan Scenario A terlebih dahulu.
7. Jalankan Scenario B atau C sesuai waktu.
8. Jika ada gangguan, gunakan screen recording sebagai fallback.
9. Setelah demo, jangan kirim pesan keluar atau mengubah provider ke live.
```

## Di luar scope

- Integrasi Meta WhatsApp Cloud API.
- Pengiriman ke nomor WhatsApp nyata.
- Verifikasi delivery/read status dari provider eksternal.
- Chatbot edukasi bebas.
- Penggantian WhatsApp Simulator dengan aplikasi WhatsApp asli.
- Penggunaan Supabase sebagai pengganti `MockWhatsAppProvider`.
