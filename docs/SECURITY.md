# SECURITY — Keamanan Data Kesehatan CareLoop

**Versi:** 1.0 · **Terkait:** [DATABASE.md](DATABASE.md), [API.md](API.md), [AGENTS.md](AGENTS.md)

Dokumen ini menguraikan pendekatan keamanan CareLoop dengan acuan **UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)** Indonesia, praktik umum keamanan aplikasi, dan pembatasan hackathon (data sintetis, MVP).

---

## Daftar Isi

1. [Prinsip Keamanan](#1-prinsip-keamanan)
2. [Klasifikasi Data](#2-klasifikasi-data)
3. [Kepatuhan UU PDP (Indonesia)](#3-kepatuhan-uu-pdp-indonesia)
4. [Autentikasi & Otorisasi](#4-autentikasi--otorisasi)
5. [Enkripsi](#5-enkripsi)
6. [Perlindungan API](#6-perlindungan-api)
7. [Keamanan WhatsApp](#7-keamanan-whatsapp)
8. [Audit Log](#8-audit-log)
9. [Privasi oleh Desain (Data Minimization)](#9-privasi-oleh-desain)
10. [Penanganan Insiden](#10-penanganan-insiden)
11. [Checklist Implementasi](#11-checklist-implementasi)

---

## 1. Prinsip Keamanan

1. **Data sintetis di semua environment** — tidak ada data pasien riil dalam repo, seed, atau test (lihat AGENTS.md §2). Ini menghilangkan risiko terbesar di hackathon.
2. **Least privilege** — setiap role hanya melihat data yang menjadi scope-nya.
3. **Enkripsi di transit & saat istirahat** untuk data pribadi/kesehatan.
4. **Minimisasi** — kumpulkan hanya data yang dibutuhkan fitur.
5. **Auditability** — semua aksi sensitif tercatat.
6. **Keamanan WhatsApp & webhook** — nomor adalah identitas; perlakukan seperti credential.
7. **Zero-trust default** — validasi input, jangan percaya klaim klien, gunakan server-side authorization.

## 2. Klasifikasi Data

| Kelas | Contoh | Perlindungan |
|---|---|---|
| **Rahasia (PII/health sensitive)** | NIK, no. HP, lokasi presisi, vital detail, riwayat kepatuhan, BPJS number | Enkripsi at-rest (kolom), minimal exposure di API, akses RBAC ketat, audit |
| **Internal** | Nama faskes, konfigurasi, log non-PII | Hanya staff/nakes |
| **Publik/anonim** | Agregat kepatuhan per wilayah, jumlah insiden | Bisa di-export setelah anonimisasi |

## 3. Kepatuhan UU PDP (Indonesia)

UU PDP (UU 27/2022) menekankan **kewajiban pemilik/processor data**:

| Prinsip UU PDP | Implementasi CareLoop |
|---|---|
| **Persetujuan (consent)** | Checkbox/tombol persetujuan di onboarding pasien & keluarga (`users.consent_pdp_at`); consent terpisah untuk membagikan data dengan nakes. |
| **Minimisasi data** | Hanya kumpulkan kolom yang dipakai fitur; lokasi presisi hanya saat darurat; `raw_payload` vital dianonimkan sebelum simpan. |
| **Pembatasan tujuan** | Data dipakai hanya untuk kepatuhan & keselamatan; export hanya agregat anonim. |
| **Keamanan & kerahasiaan** | Enkripsi, RBAC, audit (dokumen ini). |
| **Hak subjek data** | Endpoint untuk pasien: lihat data (`GET /v1/patients/me`), koreksi (`PUT`), dan **penghapusan** (`DELETE /v1/patients/me` → anonimisasi). |
| **Pemberitahuan pelanggaran** | Proses insiden §10; default memberitahu dalam waktu wajar. |
| **Penyimpanan terbatas** | Retensi policy: log vital & compliance dihapus/dianonimkan setelah periode demo; data tak aktif bisa dianonimkan. |
| **Transfer data** | Provider cloud (Vercel/Railway) dengan DPA; tidak ada transfer data pribadi lintas batas (regional hosting default). |

> Catatan MVP: compliance penuh UU PDP tidak mungkin dicapai di hackathon; fokus menerapkan **prinsip-prinsip inti** + dokumentasi niat. Data sintetis menjadikan risiko praktis nol.

## 4. Autentikasi & Otorisasi

### 4.1 Skema Role (RBAC)

| Role | Login | Scope Data |
|---|---|---|
| `PATIENT` | OTP WhatsApp (nomor terverifikasi) | Data diri + data yang diizinkan keluarga untuknya |
| `FAMILY` | OTP WhatsApp | Hanya pasien yang mendaftarkannya sebagai kontak (per patient scope) + flag `can_view_health`, `can_receive_emergency` |
| `NAKES` | username+password (bcrypt), 2FA opsional | Pasien dalam scope: puskesmas/wilayah (`nakes_assignments`) |
| `ADMIN` | username+password + 2FA wajib | Semua (terbatas, audit ketat) |

### 4.2 JWT
- `accessToken` (short, misal 24 jam) + `refreshToken` (misal 30 hari, revocable).
- Klaim JWT: `sub`, `role`, `scope` (misal `puskesmas:ps1`), `iss`, `aud`, `exp`.
- **Jangan** masukkan data sensitif ke payload JWT (hanya id/role/scope).
- Secret kuat (≥ 32 byte) di env; rotasi didukung.

### 4.3 Otorisasi Server-side
- Setiap request memeriksa scope: pasien hanya akses dirinya; keluarga hanya pasien yang `family_contacts`-nya mencantumkan dia (aktif); nakes hanya pasien dalam scope assignment.
- Family **tidak** dapat melihat vital detail kecuali `can_view_health=true`.
- Emergency alert membedakan: keluarga lihat ringkasan + lokasi; nakes lihat penuh.

### 4.4 OTP
- 6 digit, TTL 5 menit, max 5 percobaan per 10 menit; hash OTP disimpan (bukan plaintext).
- Nomor WA tujuan verifikasi = nomor yang terdaftar (hindari OTP ke nomor acak).

## 5. Enkripsi

### 5.1 Transport
- Wajib HTTPS di semua env (Vercel/Railway default).
- HSTS header diaktifkan.
- WebSocket over WSS (socket.io `transports: ['websocket']` di produksi).

### 5.2 At-Rest
| Data | Metode |
|---|---|
| Database disk | Enkripsi volume/managed (Railway/Neon default) |
| **Kolom sensitif** (phone, nik, address, last_known_location, bpjs_number, vital `raw_payload`) | Enkripsi aplikasi-level (AES-256-GCM, key di env `DATA_ENCRYPTION_KEY`), dekripsi hanya saat perlu |
| Password | bcrypt (cost 12) |
| OTP | hash SHA-256 dengan salt |
| File (OCR resep) | Server-side encryption (object storage) + URL short-lived (presigned) |
| Redis | Opsional TLS; jangan simpan data sensitif penuh di Redis (cache agregat saja) |

### 5.3 Key Management (MVP)
- Kunci enkripsi di env (bukan di repo); untuk produksi → KMS/Secrets Manager. Daftar env: [AGENTS.md](AGENTS.md#environment-variables).

## 6. Perlindungan API

- **Rate limiting** (lihat tabel API.md §8):
  - OTP request/verify: 5/mnt per phone.
  - Umum: 120 req/mnt/token.
  - Webhook WA: 300/mnt/IP.
  - WS handshake: 30/mnt/IP.
  - Export download: 20/mnt/user.
- **CORS**: whitelist origin frontend (Vercel domain), bukan `*`.
- **Validation**: zod di semua body/query/params; reject unknown fields.
- **Idempotency**: webhook & event device — dedup via `event_id`/`source_message_id` (guard `409`/ignore).
- **Security headers** (web): `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- **Orm/query**: parameterized (Prisma), tidak ada raw SQL dari input.
- **Error handling**: tidak mengekspos stack/internal (API.md §1.5).

## 7. Keamanan WhatsApp

- **Double opt-in**: pasien/keluarga wajib memberikan nomor & setuju dikontak via WA (`consent_pdp_at`) sebelum pesan dikirim.
- **Verifikasi webhook**: verifikasi signature HMAC-SHA256 (Meta `X-Hub-Signature-256`) + `hub.verify_token` saat setup. Gagal → `401`, tanpa proses.
- **Verifikasi nomor kontak**: sebelum kontak keluarga aktif menerima alert, kirim pesan konfirmasi (link OTP) — kontak yang tidak diverifikasi `is_active=false` (hindari mengirim info pasien ke nomor salah).
- **Data minim di pesan**: pesan keluarga tidak menyertakan detail medis yang tidak perlu; link ke dashboard dengan short-lived token bila perlu detail.
- **Jangan gunakan WA biasa/unofficial** (wabot) — risiko kebocoran & diblokir (ADR-002).
- **Nomor pasien dianggap rahasia**: tidak pernah terekspos lintas user kecuali via layanan.

## 8. Audit Log

### 8.1 Event yang Wajib Dicatat (tabel `audit_logs`)
| Kategori | Contoh action |
|---|---|
| Auth | `auth.login`, `auth.otp.request`, `auth.refresh` |
| Pasien | `patient.created`, `patient.updated`, `patient.deleted`, `patient.consent.given` |
| Keluarga/kontak | `family_contact.added`, `.updated`, `.removed` |
| Kepatuhan | `compliance.confirmed` (dari WA/app), `.deferred` |
| Darurat & eskalasi | `emergency.triggered`, `escalation.step`, `escalation.handled`, `emergency.resolved` |
| Data sensitif | setiap akses ke kolom terenkripsi (dekripsi) |
| Export | `export.job.created`, `export.downloaded` |
| Admin | `admin.export`, `admin.audit.view` |

### 8.2 Isi
`actor`, `role`, `action`, `resource_type/id`, `patient_id` (konteks), `ip`, `user_agent`, `meta` (non-sensitif), `created_at`.

### 8.3 Aturan
- Append-only; tidak ada update/delete (kecuali retensi setelah periode).
- Time source: server clock (NTP).
- Akses audit log hanya `ADMIN` (+ `NAKES` untuk scope sendiri).

## 9. Privasi oleh Desain (Data Minimization)

1. **Lokasi presisi**: hanya disimpan bila darurat terpicu; default tidak streaming kontinu. Pasien/keluarga bisa mematikan. `last_known_location` dihapus otomatis setelah alert selesai (opsional per kebijakan).
2. **Vital signs**: `raw_payload` dianonimkan (drop metadata perangkat) sebelum persist.
3. **Export anonim**: wajib tanpa PII (AC-13.1); job export melakukan anonimisasi (hapus nama/NIK/HP/alamat/lokasi presisi) sebelum menghasilkan file.
4. **Data lama**: retensi default 12 bulan untuk MVP; opsi penghapusan penuh oleh pasien.
5. **Perangkat dev**: `.env` tidak di-commit; secret scan di CI.

## 10. Penanganan Insiden

**Alur singkat (MVP):**
1. Deteksi → tim shift mengumpulkan fakta (log, timeframe, data yang terpengaruh).
2. **Containment**: putar secret (env), nonaktifkan token/endpoint, matikan webhook bila perlu.
3. **Klasifikasi**: kategori (data terpapar / akun tercompromise / denial) & perkiraan dampak.
4. **Pemberitahuan** (bila data pribadi terpapar): informasikan subjek data & pemilik data (rumah sakit/puskesmas/Dinkes) sesuai UU PDP dalam waktu wajar.
5. **Recovery & pelajaran**: update dokumen ini, tambahkan kontrol, tambahkan test security.
6. Karena MVP memakai **data sintetis**, dampak insiden dibatasi; namun proses tetap dilaksanakan untuk kebiasaan.

**Contacts**: kanal internal (misal `#security` channel) + `security@careloop.dev` (placeholder).

## 11. Checklist Implementasi

**Auth & sesi**
- [ ] OTP rate-limited; hash OTP; expire 5 menit
- [ ] JWT secret ≥ 32 byte; refresh revocable; logout revoke
- [ ] Semua endpoint role-check server-side (tidak hanya UI)

**Data**
- [ ] Kolom sensitif terenkripsi at-rest (aplikasi-level)
- [ ] HTTPS/WSS di produksi; HSTS
- [ ] `raw_payload` vital dianonimkan
- [ ] Export anonim tanpa PII
- [ ] Retensi & penghapusan (hak subjek data) tersedia

**API/webhook**
- [ ] Rate limiting aktif
- [ ] Validasi zod semua input; unknown field ditolak
- [ ] Signature webhook WA diverifikasi
- [ ] Idempotency guard pada webhook & ingest
- [ ] Security headers (web)

**Operasional**
- [ ] Secret di env, bukan repo; `.gitignore` benar; secret scan CI
- [ ] Audit log append-only untuk event sensitif
- [ ] Backup DB harian (managed)
- [ ] `.env.example` lengkap tanpa nilai riil

**Uji keamanan (minimal)**
- [ ] Test RBAC: keluarga A tidak bisa akses pasien B
- [ ] Test akses lintas-puskesmas ditolak
- [ ] Test webhook tanpa signature → 401
- [ ] Test OTP brute force → ter-rate-limit
- [ ] Test export tidak mengandung PII
