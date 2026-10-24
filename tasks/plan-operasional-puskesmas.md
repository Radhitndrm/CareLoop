# Plan Baru — Operasional Puskesmas & Onboarding End-to-End

**Tujuan:** mengubah CareLoop dari sistem monitoring berbasis data seed menjadi alur operasional yang dapat dipakai puskesmas: setup organisasi, onboarding staf, pendaftaran pasien, aktivasi klinis, lalu monitoring harian.

**Prioritas:** P0 untuk flow inti dan kesiapan demo; P1 untuk operasional yang lebih lengkap.  
**Prinsip:** selesaikan satu alur end-to-end sebelum menambah fitur P1/P2.

## Target flow

```text
Setup puskesmas
  → buat akun staf + role + penugasan wilayah
  → cari/daftarkan pasien
  → lengkapi identitas + kontak keluarga + persetujuan
  → verifikasi WhatsApp
  → buat dan setujui resep
  → buat jadwal obat
  → aktifkan pasien
  → reminder → konfirmasi → eskalasi
  → dashboard monitoring dan tindak lanjut
```

## Status baseline

Yang sudah tersedia dan dipertahankan:

- autentikasi nakes/admin dan RBAC dasar;
- scope pasien berdasarkan penugasan;
- pendaftaran pasien backend;
- akun nakes backend dan assignment awal;
- resep draft/approved;
- reminder, compliance, emergency, escalation, dan dashboard inti;
- pembatasan klinis dokter/bidan serta pembatasan akses farmasi.

Gap utama yang harus ditutup:

- form masih meminta UUID puskesmas secara manual;
- belum ada master data dan pemilihan puskesmas yang layak dipakai operator;
- onboarding pasien belum multi-step dan belum memasukkan keluarga;
- belum ada status onboarding/activation pasien;
- manajemen staf masih create/list saja;
- mobile masih memiliki flow demo/default schedule dan autentikasi yang belum konsisten;
- beberapa endpoint P1/P2 masih placeholder dan harus ditandai jelas atau diselesaikan.

## Prioritas berdasarkan kekurangan terbesar

Urutan ini bukan sekadar urutan teknis. Ini urutan risiko bisnis: jika item awal belum selesai, fitur di bawahnya belum dapat dipercaya dalam operasi puskesmas.

### P0-1 — Tidak ada master organisasi yang dapat dipakai operator

**Masalah saat ini:** operator harus mengetik UUID puskesmas. Belum ada alur membuat puskesmas, memilih puskesmas, melihat wilayah, atau memindahkan tanggung jawab pasien.

**Dampak bisnis:**

- pasien dapat tersambung ke organisasi yang salah;
- nakes baru bisa memiliki akun tanpa wilayah kerja;
- laporan per puskesmas tidak memiliki sumber data yang jelas;
- demo terlihat seperti alat internal developer, bukan produk puskesmas.

**Hasil yang harus dicapai:** admin membuat puskesmas dan assignment; operator memilih nama puskesmas/wilayah dari data yang tersedia; UUID hanya digunakan internal API.

### P0-2 — Onboarding pasien belum menjadi proses yang aman

**Masalah saat ini:** form pasien masih satu halaman, kondisi kesehatan berupa teks bebas, kontak keluarga belum menjadi bagian dari pendaftaran, dan pencarian duplikasi dilakukan setelah submit.

**Dampak bisnis:**

- pasien yang sama mudah terdaftar dua kali;
- eskalasi tidak memiliki tujuan jika keluarga belum dimasukkan;
- data klinis tidak cukup untuk membuat resep dan reminder;
- operator tidak tahu pasien sudah siap atau masih kurang data.

**Hasil yang harus dicapai:** pencarian pasien → wizard onboarding → kontak keluarga → consent → verifikasi → checklist kelengkapan.

### P0-3 — Belum ada batas tegas antara pasien terdaftar dan pasien aktif

**Masalah saat ini:** data pasien dapat ada di database, tetapi belum jelas kapan scheduler boleh mengirim reminder.

**Dampak bisnis:**

- pasien belum menyetujui data bisa menerima notifikasi;
- pasien tanpa resep approved dapat masuk flow reminder;
- dashboard tidak bisa membedakan pasien baru, siap ditindaklanjuti, dan aktif.

**Hasil yang harus dicapai:** status `ONBOARDING` tidak boleh menghasilkan reminder; hanya `ACTIVE` dengan resep approved dan jadwal aktif yang boleh masuk scheduler.

### P0-4 — Manajemen staf belum mencerminkan organisasi puskesmas

**Masalah saat ini:** admin hanya dapat create/list akun nakes; belum ada edit, nonaktifkan, reset akses, assignment historis, atau invitation.

**Dampak bisnis:**

- staf yang pindah masih dapat melihat pasien lama;
- admin harus membagikan password manual;
- tidak ada kontrol saat staf berhenti atau berganti unit.

**Hasil yang harus dicapai:** invitation → aktivasi akun → assignment → perubahan role/assignment dengan audit → nonaktifkan saat tidak bertugas.

### P0-5 — Flow mobile masih bercampur dengan data demo

**Masalah saat ini:** terdapat default schedule UUID, token pasien belum konsisten dipakai, dan tombol 112 muncul di layar konfirmasi obat.

**Dampak bisnis:**

- pasien dapat melihat data yang bukan miliknya;
- demo sukses hanya karena dummy data;
- aksi darurat tidak memiliki konteks yang jelas.

**Hasil yang harus dicapai:** OTP pasien → token → jadwal aktual → konfirmasi milik sendiri; tombol 112 hanya muncul pada emergency aktif.

### P1-1 — Dashboard belum menjadi daftar pekerjaan

Statistik sudah tersedia, tetapi operator juga membutuhkan antrian tindakan:

- pasien belum lengkap;
- menunggu verifikasi;
- belum punya kontak keluarga;
- belum punya resep approved;
- reminder/escalation aktif;
- emergency yang belum ditangani.

### P1-2 — Placeholder belum dibedakan dari fitur produksi

Reminder pasien, risk, edukasi, faskes, dan export masih memiliki endpoint placeholder. Fitur seperti ini harus dipilih: benar-benar diimplementasikan, diberi label mock, atau disembunyikan dari flow utama.

## Aturan flow bisnis

Aturan berikut menjadi guardrail seluruh implementasi:

1. **Satu sumber organisasi:** setiap pasien aktif memiliki satu puskesmas utama yang jelas.
2. **Tidak ada reminder sebelum aktivasi:** status `ONBOARDING`, `INACTIVE`, dan `BLOCKED` tidak diproses scheduler.
3. **Tidak ada keputusan klinis dari UI saja:** approve resep dan threshold HR selalu divalidasi backend.
4. **Tidak ada eskalasi tanpa kontak valid:** minimal satu kontak keluarga atau kontak nakes harus tersedia sebelum aktivasi.
5. **Tidak ada data klinis untuk farmasi:** farmasi hanya menerima data yang diperlukan untuk menyiapkan obat.
6. **Tidak ada auto-call:** 112 hanya berupa tombol manual/deep link.
7. **Semua perubahan penting dapat diaudit:** actor, waktu UTC, resource, perubahan, dan alasan.
8. **Duplikasi ditangani sebelum create final:** nomor WhatsApp/NIK harus dicari sebelum membuat user baru.
9. **Data demo harus sintetis:** seed dan test tidak boleh menggunakan data pasien riil.

## Flow detail per aktor

### Flow 1 — Admin pusat membuat organisasi

```text
Login admin
  → buka Pengaturan Organisasi
  → buat puskesmas
  → isi nama, tipe, alamat, wilayah, kontak, status aktif
  → simpan
  → puskesmas muncul di dropdown dan daftar assignment
```

**Validasi:**

- nama wajib dan tidak boleh duplikat dalam wilayah yang sama;
- puskesmas nonaktif tidak dapat dipilih untuk pasien/staf baru;
- perubahan alamat/kontak dicatat audit;
- hanya admin yang dapat membuat atau menonaktifkan puskesmas.

### Flow 2 — Admin membuat staf

```text
Admin memilih puskesmas
  → klik Tambah Staf
  → isi identitas kontak
  → pilih role: dokter/perawat/bidan/kader/farmasi
  → pilih assignment puskesmas/wilayah
  → sistem membuat invitation
  → staf membuka invitation
  → staf membuat password dan menyetujui akun
  → akun ACTIVE dan dapat login
```

**State akun:**

```text
INVITED → ACTIVE → SUSPENDED → DEACTIVATED
```

**Aturan:**

- role klinis ditentukan admin, bukan dari klaim staf;
- `FARMASI` tidak dapat diberi permission klinis;
- staf tanpa assignment aktif tidak dapat melihat pasien;
- reset password tidak menampilkan password lama;
- deactivation mencabut login dan menghentikan akses baru, tetapi audit lama dipertahankan.

### Flow 3 — Nakes mencari atau mendaftarkan pasien

```text
Nakes membuka Data Pasien
  → klik Daftarkan Pasien
  → masukkan nomor WhatsApp atau NIK
  → sistem mencari kecocokan
```

Jika pasien ditemukan:

```text
Tampilkan kecocokan terbatas
  → verifikasi identitas secara manual
  → pilih Hubungkan ke Puskesmas
  → buat assignment pasien
  → lanjutkan data yang masih kurang
```

Jika pasien tidak ditemukan:

```text
Klik Buat Pasien Baru
  → wizard identitas
  → wizard alamat/wilayah
  → wizard kondisi kesehatan
  → wizard keluarga dan eskalasi
  → consent
  → ringkasan
  → simpan ONBOARDING
```

**Pencegahan duplikasi:**

- pencarian nomor WhatsApp dan NIK dilakukan sebelum final submit;
- jika nomor sudah milik non-pasien, operator tidak boleh mengubah role tanpa proses admin;
- conflict dari database tetap ditangani untuk race condition;
- operator harus melihat alasan mengapa create ditolak dan pilihan tindak lanjutnya.

### Flow 4 — Wizard data pasien

#### Langkah A — Identitas

- nama lengkap;
- nomor WhatsApp;
- NIK opsional sesuai kebijakan;
- tanggal lahir;
- jenis kelamin.

#### Langkah B — Alamat dan organisasi

- alamat;
- provinsi/kota/kecamatan/kelurahan atau kode wilayah terstruktur;
- puskesmas utama dari dropdown;
- situasi tinggal: sendiri, dengan keluarga, jauh dari keluarga, lainnya.

#### Langkah C — Kondisi dan perangkat

- kondisi penyakit dari pilihan standar;
- catatan tambahan non-diagnostik;
- smartwatch aktif/tidak;
- voice reminder aktif/tidak;
- timezone pasien.

#### Langkah D — Keluarga dan eskalasi

- minimal satu kontak jika pasien memilih `FAMILY_FIRST`;
- nama, nomor, hubungan, tier, prioritas, kedekatan;
- izin menerima alert darurat;
- izin melihat informasi kesehatan;
- verifikasi/undangan kontak.

#### Langkah E — Consent dan ringkasan

- persetujuan pemrosesan data;
- persetujuan berbagi dengan nakes;
- ringkasan seluruh data;
- daftar field yang masih kosong;
- tombol `Simpan sebagai onboarding`.

**Catatan UX:** operator dapat menyimpan draft onboarding, tetapi draft tidak boleh mengaktifkan reminder atau eskalasi.

### Flow 5 — Verifikasi pasien

```text
Pasien dibuat ONBOARDING
  → sistem mengirim instruksi OTP melalui WhatsApp sandbox/mock
  → pasien login di mobile
  → pasien memasukkan OTP
  → isVerified = true
  → checklist onboarding diperbarui
```

Jika nomor belum dapat diverifikasi:

- pasien tetap `ONBOARDING`;
- operator dapat mengirim ulang instruksi sesuai cooldown;
- tidak boleh ada fallback sukses palsu;
- status kegagalan terlihat di detail pasien.

### Flow 6 — Aktivasi klinis

```text
Pasien ONBOARDING
  → nakes membuat resep DRAFT
  → dokter/bidan review
  → APPROVED atau REJECTED
  → nakes membuat jadwal dari resep APPROVED
  → sistem mengecek checklist
  → dokter/bidan/admin mengaktifkan pasien
  → pasien ACTIVE
  → scheduler mulai bekerja
```

Checklist aktivasi:

```text
[ ] puskesmas utama aktif
[ ] consent tersedia
[ ] nomor pasien terverifikasi
[ ] data minimum lengkap
[ ] kontak eskalasi tersedia
[ ] resep APPROVED
[ ] jadwal aktif
```

Jika satu item belum selesai, tombol aktivasi harus disabled dan menampilkan link langsung ke perbaikannya.

### Flow 7 — Operasi harian pasien

```text
Scheduler menemukan pasien ACTIVE + jadwal aktif
  → kirim reminder WhatsApp
  → pasien menekan Sudah Minum
  → compliance CONFIRMED/CONFIRMED_LATE
  → escalation dibatalkan
```

Jika pasien menunda:

```text
Tunda
  → buat reminder ulang dengan batas configurable
  → pasien konfirmasi atau tetap tidak merespons
```

Jika pasien tidak merespons:

```text
timeout pasien
  → keluarga tier 1
  → timeout
  → keluarga tier 2
  → timeout/tidak ada kontak
  → nakes/kader
  → handled atau timed out
```

Setiap transition harus idempoten dan tersimpan di audit/escalation log.

### Flow 8 — Operasi darurat

```text
Smartwatch/mock mengirim dua bacaan abnormal
  → emergency PENDING_PATIENT_CONFIRM
  → pasien menerima pertanyaan "Apakah Anda aman?"
```

Cabang:

- `SAFE` → `RESOLVED_SAFE`, tidak ada alert keluarga;
- `NEED_HELP` → mulai eskalasi;
- timeout → mulai eskalasi;
- lokasi tersedia → sertakan maps link;
- lokasi tidak tersedia → alert tetap dikirim dengan keterangan jelas;
- aplikasi menampilkan tombol manual `Panggil 112`;
- tidak ada kode yang memulai panggilan otomatis.

### Flow 9 — Tindakan dashboard nakes

```text
Login
  → dashboard work queue
  → pilih item
  → buka detail pasien/alert
  → lakukan aksi sesuai role
  → sistem menyimpan actor, waktu, status, dan catatan
```

Contoh aksi:

- melengkapi pasien;
- menambahkan keluarga;
- membuat draft resep;
- approve/reject jika dokter/bidan;
- menangani escalation;
- melihat lokasi emergency jika berwenang;
- mengarahkan pasien ke refill.

## Fase A — Kontrak domain dan status onboarding

**Tujuan:** menetapkan sumber kebenaran status operasional sebelum memperluas UI.

- [ ] Definisikan status pasien: `ONBOARDING`, `ACTIVE`, `INACTIVE`, `BLOCKED`.
- [ ] Definisikan kriteria pasien boleh aktif:
  - identitas minimum lengkap;
  - consent PDP tercatat;
  - nomor WhatsApp terverifikasi;
  - puskesmas penanggung jawab tersedia;
  - minimal satu kontak eskalasi valid;
  - minimal satu resep `APPROVED` dan jadwal aktif.
- [ ] Tambahkan relasi eksplisit pasien ke puskesmas utama atau tabel assignment pasien-puskesmas.
- [ ] Tambahkan audit event untuk perubahan status pasien, assignment, dan verifikasi.
- [ ] Update `packages/shared`, Prisma schema, migrasi, [docs/DATABASE.md](../docs/DATABASE.md), dan [docs/API.md](../docs/API.md).
- [ ] Tambahkan unit test transisi status dan aturan aktivasi.

**Definition of done:**

- status tidak dapat dilompati tanpa prasyarat;
- reminder tidak dibuat untuk pasien yang belum `ACTIVE`;
- migrasi dapat dijalankan pada database development;
- typecheck, lint, dan test terkait lulus.

## Fase B — Master data puskesmas dan assignment staf

**Tujuan:** menghilangkan ketergantungan operator pada UUID dan membuat struktur organisasi dapat dikelola.

- [ ] Sediakan endpoint terautentikasi untuk daftar/detail puskesmas.
- [ ] Tambahkan CRUD puskesmas untuk admin:
  - nama;
  - tipe;
  - alamat;
  - wilayah;
  - nomor kontak;
  - status aktif.
- [ ] Tambahkan endpoint daftar wilayah yang dapat dipilih operator.
- [ ] Ganti input `puskesmasId` di web menjadi dropdown nama puskesmas.
- [ ] Jika nakes hanya memiliki satu assignment aktif, pilih otomatis dan tampilkan sebagai read-only.
- [ ] Tambahkan pengelolaan assignment staf:
  - tambah assignment;
  - ubah assignment;
  - nonaktifkan assignment;
  - dukung lebih dari satu puskesmas bila diperlukan.
- [ ] Pastikan pembuatan akun nakes dan assignment dilakukan dalam satu transaksi.
- [ ] Tambahkan tampilan penugasan pada daftar staf.

**Definition of done:**

- tidak ada field UUID puskesmas untuk penggunaan normal;
- staf baru selalu memiliki assignment valid;
- pasien baru otomatis terkait puskesmas yang dipilih;
- akses nakes tetap dibatasi berdasarkan assignment server-side.

## Fase C — Onboarding pasien operator-friendly

**Tujuan:** membuat pendaftaran pasien realistis untuk petugas puskesmas dan mencegah duplikasi data.

- [ ] Tambahkan langkah pencarian awal berdasarkan nomor WhatsApp/NIK.
- [ ] Jika pasien sudah ada, tampilkan opsi:
  - lihat data;
  - hubungkan ke puskesmas;
  - lanjutkan onboarding;
  - batalkan.
- [ ] Pecah form menjadi beberapa langkah:
  1. identitas dasar;
  2. alamat dan wilayah;
  3. kondisi kesehatan;
  4. situasi tinggal dan preferensi eskalasi;
  5. kontak keluarga tier 1/tier 2;
  6. persetujuan dan perangkat.
- [ ] Gunakan pilihan terstruktur untuk penyakit, gender, situasi tinggal, dan preferensi eskalasi.
- [ ] Tambahkan validasi nomor WhatsApp, NIK, tanggal lahir, dan field wajib.
- [ ] Tampilkan checklist kelengkapan onboarding.
- [ ] Kirim instruksi OTP/verifikasi setelah pasien dibuat.
- [ ] Tambahkan halaman detail pasien untuk mengelola kontak keluarga dan status onboarding.
- [ ] Pastikan data sensitif tidak ditampilkan ke role farmasi.

**Definition of done:**

- operator dapat menyelesaikan pendaftaran tanpa mengetahui UUID;
- pasien duplikat terdeteksi sebelum submit final;
- kontak keluarga dapat dibuat dan diberi tier;
- audit log mencatat actor dan perubahan penting;
- test mencakup validasi dan duplicate flow.

## Fase D — Clinical activation

**Tujuan:** menghubungkan onboarding administratif dengan proses klinis dan scheduler.

- [ ] Tambahkan flow membuat resep draft dari halaman pasien.
- [ ] Tambahkan field resep yang diperlukan:
  - nama/generik obat;
  - dosis;
  - instruksi;
  - tanggal mulai/selesai;
  - days supply.
- [ ] Tambahkan flow dokter/bidan approve/reject dengan catatan.
- [ ] Tambahkan flow membuat jadwal dari resep approved.
- [ ] Tampilkan alasan pasien belum dapat diaktifkan.
- [ ] Tambahkan tombol `Aktifkan pasien` hanya jika semua prasyarat terpenuhi.
- [ ] Pastikan scheduler hanya mengambil resep/jadwal approved dan pasien active.
- [ ] Tampilkan status aktivasi di dashboard dan daftar pasien.
- [ ] Tambahkan integration test: onboarding → approved medication → schedule → active.

**Definition of done:**

- pasien onboarding tidak menerima reminder;
- pasien active menerima reminder berdasarkan jadwal aktual;
- resep draft tidak menghasilkan reminder/compliance/escalation;
- gate dokter/bidan tetap ditegakkan di backend.

## Fase E — Perbaikan aplikasi pasien

**Tujuan:** memastikan pasien menggunakan data aktual, bukan data demo/default.

- [ ] Implementasikan OTP login pasien di mobile.
- [ ] Simpan token secara aman dan gunakan pada seluruh endpoint pasien.
- [ ] Ambil reminder/jadwal aktif dari API.
- [ ] Hapus default schedule UUID dari flow normal.
- [ ] Tampilkan nama obat, dosis, instruksi, dan waktu dari server.
- [ ] Tampilkan tombol 112 hanya pada emergency aktif.
- [ ] Tambahkan state loading, empty, expired, already confirmed, dan offline.
- [ ] Pastikan deep link WhatsApp memuat resource ID yang valid dan aman.
- [ ] Tambahkan test untuk token, ownership schedule, dan konfirmasi idempoten.

**Definition of done:**

- pasien baru dapat login dan melihat jadwal miliknya;
- pasien tidak dapat mengonfirmasi jadwal pasien lain;
- tombol emergency tidak muncul pada layar obat biasa;
- mobile flow berhasil tanpa dummy UUID.

## Fase F — Operational dashboard dan follow-up

**Tujuan:** menjadikan dashboard sebagai work queue, bukan hanya statistik.

- [ ] Tambahkan widget `Pasien perlu dilengkapi`.
- [ ] Tambahkan widget `Menunggu verifikasi WhatsApp`.
- [ ] Tambahkan widget `Belum ada kontak keluarga`.
- [ ] Tambahkan widget `Belum ada resep approved`.
- [ ] Tambahkan widget `Reminder/escalation aktif`.
- [ ] Tambahkan filter puskesmas, wilayah, status onboarding, dan risiko.
- [ ] Tambahkan aksi cepat dari dashboard menuju detail pasien.
- [ ] Tambahkan penanganan emergency: buka detail, hubungi pasien, tandai ditangani.
- [ ] Tambahkan status dan riwayat assignment staf.
- [ ] Pastikan farmasi hanya melihat queue yang diperlukan untuk dispensing.

## Fase G — Placeholder dan fitur P1/P2

Setelah flow P0 di atas stabil:

- [ ] Implementasikan endpoint reminders pasien yang saat ini masih mengembalikan array kosong.
- [ ] Implementasikan risk score rule-based yang konsisten dengan dashboard.
- [ ] Implementasikan data faskes terdekat atau tandai eksplisit sebagai mock.
- [ ] Isi konten edukasi minimum dan fallback ke nakes.
- [ ] Implementasikan export anonim sesuai kontrak.
- [ ] Tambahkan refill reminder yang terhubung dengan stok dan dispensing.

Fitur yang belum selesai tidak boleh terlihat seperti berhasil. Gunakan status UI yang jelas:

```text
Tersedia
Demo/mock
Segera hadir
Tidak tersedia untuk role ini
```

## Fase H — Verifikasi dan demo journey

- [ ] Jalankan migrasi dari database kosong.
- [ ] Seed hanya data sintetis.
- [ ] Jalankan `npm run typecheck`.
- [ ] Jalankan `npm run lint`.
- [ ] Jalankan test unit dan integration.
- [ ] Verifikasi seluruh endpoint `/v1/*` yang bukan auth/webhook memerlukan token.
- [ ] Verifikasi tidak ada auto-dial 112.
- [ ] Verifikasi farmasi tidak dapat mengakses data klinis yang tidak perlu.
- [ ] Jalankan demo journey:
  1. admin membuat puskesmas;
  2. admin membuat dokter/perawat/farmasi;
  3. nakes mendaftarkan pasien;
  4. nakes menambahkan keluarga;
  5. dokter approve resep;
  6. nakes membuat jadwal;
  7. pasien login OTP;
  8. pasien menerima reminder;
  9. pasien konfirmasi;
  10. demo timeout dan eskalasi;
  11. demo emergency dan tombol manual 112;
  12. dashboard menampilkan tindak lanjut.
- [ ] Catat hasil demo dan gap tersisa di issue, bukan dengan menutupi fitur yang belum berjalan.

## Fase I — Persiapan Supabase dan deployment cloud

**Tujuan:** memindahkan database bersama dari PostgreSQL lokal ke Supabase PostgreSQL tanpa merombak service backend, Prisma, RBAC, atau business rule.

### Keputusan arsitektur

Target arsitektur:

```text
Web Next.js ───────┐
                   ├── HTTPS ──→ Fastify API ──→ Prisma ──→ Supabase PostgreSQL
Mobile Expo ──────┘                    │
                                       ├──→ Redis/BullMQ hosted
                                       ├──→ WhatsApp provider/mock
                                       └──→ WebSocket dashboard
```

Keputusan yang harus dipertahankan:

- Supabase dipakai sebagai managed PostgreSQL, bukan sebagai pengganti Fastify API.
- Web dan mobile tidak boleh mengakses database secara langsung.
- `DATABASE_URL` hanya berada di environment backend.
- Prisma tetap menjadi data access layer.
- JWT, RBAC, audit, clinical gate, dan state machine tetap berada di backend.
- Supabase Auth dan Supabase Realtime bukan bagian dari migrasi awal.
- Tidak menambahkan `@supabase/supabase-js` kecuali ada kebutuhan yang disetujui terpisah.

### I.1 Audit kompatibilitas sebelum membuat project

- [ ] Inventaris semua model, enum, index, constraint, transaction, dan extension Prisma.
- [ ] Pastikan seluruh migration lokal dapat direplay dari database kosong.
- [ ] Pastikan schema menggunakan fitur PostgreSQL yang tersedia di Supabase.
- [ ] Catat query yang sensitif terhadap connection pooling atau prepared statement.
- [ ] Identifikasi job/worker yang membutuhkan koneksi database jangka panjang.
- [ ] Identifikasi data sensitif yang tidak boleh muncul di log atau seed.
- [ ] Pastikan seluruh service backend hanya menggunakan `prisma`/repository, bukan koneksi database langsung.

**Output:** checklist kompatibilitas dan daftar risiko sebelum cutover.

### I.2 Buat environment terpisah

Minimal siapkan tiga target:

```text
local      → PostgreSQL Docker + Redis Docker
staging    → Supabase project staging + Redis hosted staging
production → Supabase project production/demo + Redis hosted production
```

- [ ] Buat project Supabase staging.
- [ ] Jika demo akan dipakai terus, buat project production/demo terpisah dari staging.
- [ ] Gunakan password database yang berbeda untuk setiap environment.
- [ ] Simpan secret hanya di secret manager/environment deployment.
- [ ] Jangan menyalin `.env` ke commit, issue, screenshot, atau dokumentasi publik.
- [ ] Tambahkan tabel dokumentasi nama variable tanpa nilai rahasia.

Variable backend yang wajib:

```env
NODE_ENV=production
DATABASE_URL=<supabase-pooled-connection>
DIRECT_URL=<supabase-direct-connection>
TEST_DATABASE_URL=<separate-test-database>
REDIS_URL=<hosted-redis-url>
JWT_SECRET=<random-secret-at-least-32-characters>
DATA_ENCRYPTION_KEY=<encryption-key-if-enabled>
CORS_ORIGINS=<web-allowed-origin>
```

Aturan koneksi:

- `DATABASE_URL` dipakai runtime API dan menggunakan pooler jika direkomendasikan provider.
- `DIRECT_URL` dipakai migration/deploy schema melalui koneksi direct.
- `TEST_DATABASE_URL` tidak boleh sama dengan database staging, demo, atau production karena integration test melakukan destructive cleanup.
- URL Supabase tidak boleh masuk ke web/mobile bundle.

### I.3 Konfigurasi Prisma dan migration

- [ ] Verifikasi Prisma tetap menggunakan `provider = "postgresql"`.
- [ ] Verifikasi mekanisme migration menggunakan `DIRECT_URL` untuk koneksi direct.
- [ ] Jalankan `prisma validate` dan `prisma generate`.
- [ ] Jalankan migration dari database Supabase yang kosong.
- [ ] Jalankan `prisma migrate deploy` pada staging.
- [ ] Periksa tabel, enum, index, foreign key, dan unique constraint di Supabase.
- [ ] Pastikan migration tidak dijalankan dari endpoint aplikasi saat runtime.
- [ ] Tetapkan satu orang/CI job sebagai pemilik proses migration.

Urutan staging:

```text
buat project kosong
  → set secret backend
  → prisma migrate deploy
  → seed sintetis
  → health check
  → smoke test API
```

### I.4 Migrasi/seed data demo dengan aman

- [ ] Jangan menyalin database lokal mentah ke Supabase.
- [ ] Gunakan migration untuk struktur.
- [ ] Gunakan seed sintetis untuk data demo.
- [ ] Pastikan tidak ada NIK, nomor HP, nama, lokasi, atau data pasien riil.
- [ ] Buat akun demo dengan password baru khusus staging/demo.
- [ ] Jangan memakai secret atau password production di seed.
- [ ] Dokumentasikan cara reset staging tanpa menyentuh production.
- [ ] Verifikasi seed idempoten atau memiliki prosedur reset yang eksplisit.

### I.5 Siapkan Redis/BullMQ hosted

Supabase tidak menggantikan Redis. CareLoop tetap membutuhkan Redis untuk:

- job reminder;
- timeout eskalasi;
- retry pengiriman;
- job emergency;
- rate limit/dedup jika digunakan;
- OTP setelah dipindahkan dari memory.

- [ ] Pilih Redis hosted yang mendukung TLS.
- [ ] Set `REDIS_URL` hanya di backend/worker.
- [ ] Pisahkan Redis staging dan production/demo.
- [ ] Verifikasi BullMQ dapat membuat queue dan worker.
- [ ] Verifikasi retry/backoff dan job idempotency setelah restart worker.
- [ ] Tambahkan health check Redis tanpa membocorkan URL/credential.
- [ ] Uji behavior ketika Redis unavailable: error jelas, tidak ada success palsu.

### I.6 Pindahkan OTP dari memory

Saat ini OTP memakai `InMemoryOtpStore`, sehingga tidak cocok untuk restart atau lebih dari satu instance.

- [ ] Buat interface store OTP yang dapat memakai Redis.
- [ ] Implementasikan Redis OTP store dengan TTL.
- [ ] Simpan attempt count dan cooldown secara atomik.
- [ ] Pastikan OTP tidak pernah ditulis ke log.
- [ ] Pertahankan response anti-enumeration untuk nomor terdaftar/tidak terdaftar.
- [ ] Tambahkan test expiry, cooldown, max attempts, retry, dan restart.
- [ ] Sediakan fallback hanya untuk development/mock, bukan production.

### I.7 Deploy Fastify API

- [ ] Pilih platform API yang mendukung Node.js 20+, HTTPS, environment secret, dan WebSocket.
- [ ] Jalankan `npm run db:deploy` sebagai release/migration step sebelum server.
- [ ] Jalankan worker reminder/escalation sebagai proses terpisah atau worker yang terkelola.
- [ ] Set `PORT` dari environment platform.
- [ ] Set `CORS_ORIGINS` hanya ke origin web yang valid.
- [ ] Tambahkan endpoint health/readiness:
  - API process hidup;
  - database dapat diakses;
  - Redis dapat diakses;
  - versi migration diketahui.
- [ ] Pastikan error response tidak membocorkan stack trace atau connection string.
- [ ] Pastikan log memiliki request ID, actor/resource ID yang aman, dan tidak mencatat secret/data sensitif.
- [ ] Pastikan WebSocket dashboard dapat reconnect setelah deployment/restart.

### I.8 Hubungkan web dan mobile ke API publik

- [ ] Set `NEXT_PUBLIC_API_URL` ke HTTPS API staging/demo.
- [ ] Set `EXPO_PUBLIC_API_URL` ke HTTPS API staging/demo.
- [ ] Jangan mengisi URL database pada variable `NEXT_PUBLIC_*` atau `EXPO_PUBLIC_*`.
- [ ] Verifikasi web dapat login dan memanggil endpoint scoped.
- [ ] Verifikasi mobile dapat login OTP dan menggunakan token untuk seluruh endpoint pasien.
- [ ] Verifikasi perangkat fisik tidak menggunakan `localhost:4000`.
- [ ] Verifikasi deep link dan WebSocket memakai base URL environment yang benar.
- [ ] Pastikan build production tidak membawa URL atau secret staging yang salah.

### I.9 Security dan akses Supabase

- [ ] Simpan database password, JWT secret, WhatsApp secret, dan Redis credential di secret manager.
- [ ] Gunakan koneksi TLS.
- [ ] Batasi akses database ke service backend, bukan browser/mobile.
- [ ] Jangan membuka Supabase database ke publik lebih luas dari kebutuhan provider.
- [ ] Jangan mengandalkan RLS Supabase sebagai pengganti RBAC backend pada migrasi awal.
- [ ] Tetap enforce scope puskesmas, role klinis, dan minimisasi farmasi di API.
- [ ] Aktifkan backup/point-in-time recovery sesuai kebutuhan environment.
- [ ] Tentukan retention log dan prosedur penghapusan data demo.
- [ ] Audit siapa yang memiliki akses dashboard Supabase.

### I.10 Observability dan recovery

- [ ] Tambahkan log koneksi gagal yang hanya berisi environment dan error code aman.
- [ ] Tambahkan metric/health check untuk database, Redis, queue, dan worker.
- [ ] Uji restart API tanpa kehilangan data.
- [ ] Uji restart worker tanpa menggandakan reminder/escalation.
- [ ] Uji database connection pool exhaustion.
- [ ] Uji job timeout saat worker mati lalu hidup kembali.
- [ ] Dokumentasikan backup restore ke project staging.
- [ ] Dokumentasikan rollback aplikasi tanpa melakukan `reset` database production.
- [ ] Siapkan prosedur cutover kembali ke database lama hanya jika data sudah direkonsiliasi.

### I.11 Verification checklist sebelum go-live

- [ ] `npm run typecheck` lulus.
- [ ] `npm run lint` lulus.
- [ ] Unit test lulus.
- [ ] Integration test memakai `TEST_DATABASE_URL` terpisah.
- [ ] Migration staging lulus dari database kosong.
- [ ] Seed staging hanya sintetis.
- [ ] Login admin/nakes lulus.
- [ ] OTP pasien lulus dengan store Redis.
- [ ] Pendaftaran pasien dan scope puskesmas lulus.
- [ ] Resep draft/approved dan jadwal lulus.
- [ ] Reminder hanya dikirim untuk pasien `ACTIVE`.
- [ ] Compliance dan escalation idempoten setelah worker restart.
- [ ] Emergency alert dan WebSocket lulus.
- [ ] Farmasi tidak dapat mengakses data yang tidak diperlukan.
- [ ] Web dan mobile memakai HTTPS API publik.
- [ ] Tidak ada secret di git diff atau bundle frontend.
- [ ] Tidak ada auto-dial 112.

### I.12 Urutan cutover

```text
1. Freeze perubahan schema dan buat backup sumber
2. Buat Supabase staging
3. Deploy migration
4. Seed data sintetis
5. Deploy API + worker staging
6. Hubungkan web/mobile staging
7. Jalankan smoke test dan demo journey
8. Perbaiki temuan tanpa menyentuh production
9. Buat Supabase production/demo terpisah
10. Deploy migration production
11. Seed hanya jika environment demo
12. Deploy API/worker production
13. Update URL web/mobile
14. Pantau health check, queue, log, dan alert
```

### I.13 Scope yang sengaja tidak dikerjakan pada migrasi awal

- [ ] Jangan migrasikan auth custom ke Supabase Auth pada fase yang sama.
- [ ] Jangan mengganti Prisma service dengan Supabase SDK.
- [ ] Jangan mengganti WebSocket dengan Supabase Realtime.
- [ ] Jangan memindahkan file ke Supabase Storage sebelum ada kebutuhan upload yang nyata.
- [ ] Jangan menggabungkan database test dengan database demo/production.

**Definition of done Fase I:**

- API staging berhasil membaca dan menulis data di Supabase melalui Prisma;
- web dan mobile hanya berkomunikasi dengan API publik;
- migration dan seed sintetis dapat diulang pada environment baru;
- worker Redis/BullMQ berjalan dan restart-safe;
- OTP tidak lagi bergantung pada memory untuk environment cloud;
- smoke test seluruh flow kritis lulus;
- tidak ada secret di repository atau bundle frontend;
- ada dokumentasi deployment, backup, recovery, dan rollback.

## Urutan implementasi yang direkomendasikan

```text
Fase A → Fase B → Fase C → Fase D → Fase E → Fase F → Fase G → Fase H → Fase I
```

Fase A–E adalah jalur kritis produk. Fase I dapat dimulai setelah kontrak database dan flow inti stabil, tetapi sebelum demo online atau deployment multi-instance. Jangan menghabiskan waktu pada edukasi, export, atau polish visual sebelum onboarding sampai aktivasi pasien dapat dijalankan tanpa seed/manual UUID.
