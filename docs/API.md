# API — Dokumentasi Endpoint REST & WebSocket

**Versi:** 1.0 · **Base URL:** `https://api.careloop.dev` (dev: `http://localhost:4000`) · **Terkait:** [DATABASE.md](DATABASE.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md)

---

## 1. Konvensi Umum

### 1.1 Format
- Content-Type: `application/json` (kecuali upload/export).
- Timestamp: ISO 8601 UTC (`2026-08-16T02:30:00Z`).
- ID: **uuid v4** di semua path param & body (termasuk data seed demo). Nilai non-uuid ditolak `400 VALIDATION_ERROR`.

### 1.2 Response Shape
**Sukses:**
```json
{ "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 137 } }
```

**Error:**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Schedule tidak ditemukan",
    "details": { "field": "scheduleId", "reason": "tidak valid" }
  }
}
```

### 1.3 Kode Status HTTP
| Kode | Arti |
|---|---|
| 200 | OK |
| 201 | Created |
| 202 | Accepted (job berjalan, misal export) |
| 204 | No Content |
| 400 | Bad request / validasi |
| 401 | Unauthorized |
| 403 | Forbidden (bukan scope Anda) |
| 404 | Not found |
| 409 | Conflict (misal double aktif run) |
| 422 | Unprocessable (state machine menolak transisi) |
| 429 | Too many requests (rate limit) |
| 500 | Internal error |

### 1.4 Autentikasi & Header
- **Bearer JWT**: `Authorization: Bearer <token>`
- **Role di JWT**: `sub` (user id), `role`, `patientId` (jika pasien), scope.
- **CORS**: whitelist origin frontend (Vercel).
- Setiap request membawa `x-request-id` (trace).

### 1.5 Error Handling Convention
1. Validasi input via zod → `400` dengan `details.field` (nama field dalam camelCase).
2. Resource tidak ada → `404` + `code: NOT_FOUND`.
3. Transisi state ilegal (eskalasi sudah selesai) → `422` + `code: INVALID_TRANSITION`.
4. Duplikat idempotency → `409` + `code: ALREADY_PROCESSED`.
5. Rate limit → `429` + header `Retry-After`.
6. Semua error tidak boleh membocorkan detail internal/stack trace ke client.
7. Unknown error → `500` + `code: INTERNAL_ERROR` (detail ke log saja).

**Katalog kode error** (stabil — `apps/api/src/lib/errors.ts`, dipasang terpusat di `app.ts`):

| Kode | HTTP | Dipicu oleh |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `ZodError` (details = array `{ field, reason }`), `PrismaClientValidationError` |
| `UNAUTHORIZED` | 401 | Token hilang/kedaluwarsa |
| `FORBIDDEN` | 403 | Di luar scope RBAC |
| `NOT_FOUND` | 404 | Resource tidak ada, Prisma `P2025`, route tak dikenal |
| `CONFLICT` | 409 | Bentrok relasi (Prisma `P2003`) |
| `ALREADY_PROCESSED` | 409 | Duplikat idempotency, Prisma `P2002` (details = `{ target }`) |
| `INVALID_TRANSITION` | 422 | State machine menolak transisi |
| `RATE_LIMITED` | 429 | Rate limit (header `Retry-After`) |
| `INTERNAL_ERROR` | 500 | Error tak terduga — pesan generik, stack hanya ke log |

Controller **tidak** menangkap error sendiri: lempar helper dari `lib/errors.ts` (`notFound()`, `alreadyProcessed()`, `invalidTransition()`, …) atau biarkan Zod/Prisma melempar.

---

### 1.6 Status Ketersediaan Fitur

Endpoint yang kontraknya sudah ditulis tapi belum diimplementasikan tetap menjawab, namun
membungkus `data` dalam envelope berikut:

```json
{
  "data": {
    "status": "PENDING",
    "statusLabel": "Segera hadir",
    "statusDetail": "Belum diimplementasikan. Jangan dipakai untuk keputusan klinis.",
    "data": []
  }
}
```

| `status` | `statusLabel` | Arti |
|---|---|---|
| `AVAILABLE` | — | Fitur selesai dan berjalan |
| `MOCK` | Demo/mock | Sengaja memakai data contoh atau provider dummy |
| `PENDING` | Segera hadir | Kontrak ada, implementasi belum |
| `FORBIDDEN` | Tidak tersedia untuk role ini | Sengaja ditutup untuk peran tersebut |

Endpoint yang memakai envelope ini:

| Endpoint | Status |
|---|---|
| `GET /v1/patients/me/risk` | `MOCK` bila skor sudah tersimpan, `PENDING` bila belum pernah dihitung |
| `GET /v1/education/topics` | `PENDING` |
| `GET /v1/facilities/nearby` | `PENDING` |
| `GET /v1/export/jobs` | `PENDING` |

> `/v1/patients/me/risk` sengaja tidak pernah mengembalikan `score: 0`. Angka nol akan
> dibaca sebagai "pasien aman", padahal tidak ada perhitungan yang berjalan. Kalau belum
> ada skor, field `score` bernilai `null` dan status `PENDING`.

---

## 2. Autentikasi

### POST `/v1/auth/otp/request`
Minta OTP login via WhatsApp (pasien/keluarga).

```json
// Request
{ "phone": "0812xxxxxxx" }
```
```json
// 200 Response
{ "data": { "otpExpiresAt": "2026-08-16T02:35:00Z", "retryAfterSec": 30 } }
```
- Rate limit: 1 per 30 dtk per nomor (`OTP_RESEND_COOLDOWN_SEC`); max 5 percobaan verifikasi
  per kode (`OTP_MAX_ATTEMPTS`). Kode berlaku `OTP_TTL_SEC` detik (default 300).
- **429 `RATE_LIMITED`** saat diminta ulang sebelum cooldown habis; `details.retryAfterSec`
  berisi sisa detik.
- Respons **selalu sama** untuk nomor terdaftar maupun tidak — endpoint ini tidak bisa dipakai
  memetakan pengguna. Kode tidak pernah ikut dikembalikan di respons.
- Saat `PROVIDER_MODE=mock` kodenya tetap `OTP_MOCK_CODE` (default `123456`) dan tidak ada
  pesan WhatsApp yang dikirim. Pengiriman nyata menyusul di CL-101.

### POST `/v1/auth/otp/verify`
Verifikasi OTP → kembalikan JWT + profil. Hanya untuk role `PATIENT` & `FAMILY`.

```json
// Request
{ "phone": "0812xxxxxxx", "otp": "123456" }
```
```json
// 200 Response
{
  "data": {
    "accessToken": "eyJ...",
    "expiresIn": 86400,
    "user": { "id": "u1", "role": "PATIENT", "fullName": "Bu Ratna", "isVerified": true }
  }
}
```

- Kode sekali pakai — dihapus begitu berhasil dipakai.
- **401 `UNAUTHORIZED`** dengan pesan tunggal `Kode OTP salah atau sudah kedaluwarsa` untuk semua
  kegagalan (kode salah, kedaluwarsa, jatah percobaan habis, nomor tidak terdaftar, role
  nakes/admin, akun nonaktif).
- Kode OTP saat ini disimpan **di memori proses** — hilang saat restart dan tidak dibagi antar
  replika. Pemindahan ke Redis dijadwalkan di CL-401.

### POST `/v1/auth/login` (nakes/admin)
Kata sandi bcrypt (cost 12). Identifikasi lewat `phone` **atau** `email` — tepat salah satu.
Pasien & keluarga tidak memakai endpoint ini; mereka lewat OTP di atas.

```json
// Request
{ "phone": "081100000001", "password": "CareLoop#Demo2026" }
```
```json
// 200 Response
{
  "data": {
    "accessToken": "eyJ...",
    "expiresIn": 86400,
    "user": {
      "id": "u1",
      "role": "NAKES",
      "nakesRole": "DOKTER",
      "fullName": "dr. Dewi Lestari",
      "isVerified": true
    }
  }
}
```

- `expiresIn` dalam detik, berasal dari `JWT_EXPIRES_IN` (default `24h`).
- Claim token: `{ sub, role, nakesRole? }` — tanpa data pribadi. `nakesRole` hanya ada untuk
  akun NAKES dan menentukan kewenangan klinis (lihat §3.16).
- **401 `UNAUTHORIZED`** dengan pesan tunggal `Nomor/email atau kata sandi salah` untuk semua
  kegagalan kredensial (akun tidak ada, kata sandi salah, role bukan nakes/admin, akun tanpa
  kata sandi). Pesan sengaja tidak dibedakan agar nomor terdaftar tidak bisa ditebak.
- **403 `FORBIDDEN`** hanya jika kata sandi benar tetapi akun dinonaktifkan.
- Akun demo seed, seluruhnya memakai kata sandi `CareLoop#Demo2026` (data sintetis):

  | Nomor | Peran | NakesRole | Batasan |
  |---|---|---|---|
  | `081100000001` | NAKES | `DOKTER` | Dapat menyetujui resep & ambang HR |
  | `081100000004` | NAKES | `PERAWAT` | Hanya draft; tidak dapat menyetujui |
  | `081100000003` | ADMIN | — | Seluruh wilayah + kelola akun nakes |

### POST `/v1/auth/refresh`
Refresh JWT dengan `refreshToken` di body.

---

## 3. Endpoint per Domain

> Hanya endpoint MVP yang didokumentasikan. Header `Authorization` wajib kecuali dinyatakan "public". RBAC per role dijelaskan di setiap endpoint.

### 3.1 Pasien

Tahap 1 alur: pendaftaran & pengelolaan data dasar pasien dilakukan **nakes dalam wilayah penugasannya**; admin bebas tanpa batasan wilayah.

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me` | PATIENT, FAMILY (scope) | Profil lengkap pasien (detail jika `can_view_health`) |
| PUT | `/v1/patients/me` | PATIENT | Update profil (alamat, living_situation, timezone, voice_enabled, dll.) |
| POST | `/v1/patients` | NAKES (scope), ADMIN | **Daftarkan pasien baru** (Tahap 1) |
| GET | `/v1/patients` | NAKES (scope), ADMIN | Daftar pasien dalam scope |
| GET | `/v1/patients/:id` | NAKES (scope), ADMIN | Detail pasien |
| PUT | `/v1/patients/:id` | NAKES (scope), ADMIN | Update data dasar & riwayat penyakit |
| PUT | `/v1/patients/:id/hr-thresholds` | NAKES **DOKTER/BIDAN**, ADMIN | Tetapkan ambang detak jantung (lihat §3.4) |
| GET | `/v1/patients/:id/activation` | NAKES (scope), ADMIN | Checklist prasyarat aktivasi + alasan yang belum terpenuhi |
| POST | `/v1/patients/:id/activate` | NAKES **DOKTER/BIDAN**, ADMIN | Satu-satunya jalan menaikkan status ke `ACTIVE` |
| PATCH | `/v1/patients/:id/status` | NAKES **DOKTER/BIDAN**, ADMIN | Tangguhkan (`INACTIVE`) / blokir (`BLOCKED`) / pulihkan (`ONBOARDING`) |

**Scope:** NAKES hanya melihat dan mengubah pasien di puskesmas/distrik penugasannya. Patient di luar scope dijawab `404` (bukan `403`) agar keberadaannya tidak terkonfirmasi. ADMIN tanpa pembatasan.

Cakupan Puskesmas ditentukan oleh `patients.primary_puskesmas_id` (relasi eksplisit ke puskesmas penanggung jawab). `nakes_contacts` tetap ikut dipertimbangkan untuk pasien lama yang belum punya puskesmas utama dan untuk rujukan antar-puskesmas.

**POST /v1/patients — Request:**
```json
{
  "fullName": "Bu Ratna",
  "phone": "081200000001",
  "districtCode": "3471",
  "puskesmasId": "6f1a1e7c-3f1c-4a2b-9c1d-2b7a5e0d1a01",
  "livingSituation": "ALONE",
  "healthConditions": ["DIABETES", "HYPERTENSION"],
  "emergencyPreference": "NAKES_FIRST",
  "consentShareWithNakes": true
}
```
**Response 201:** objek pasien lengkap. `puskesmasId` wajib dan harus berada dalam scope NAKES — memilih puskesmas di luar wilayah ditolak `403`.

Sisi server membuat akun `User`(role `PATIENT`) **tanpa kata sandi** dalam transaksi yang sama, sehingga pasien hanya bisa masuk lewat OTP WhatsApp. Nakes yang mendaftar otomatis tercatat sebagai `NakesContact` utama agar pasien tersebut langsung masuk dashboard-nya.

Pasien baru **selalu** dibuat dengan `status: "ONBOARDING"` dan `primaryPuskesmasId` terisi.
Status tidak pernah langsung `ACTIVE` di endpoint ini — pengingat obat yang belum
disahkan dokter tidak boleh keluar hanya karena pasien berhasil didaftarkan.

#### Pencegahan duplikasi

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/lookup?phone=&nik=` | NAKES, ADMIN | Cek kecocokan sebelum membuat pasien |
| POST | `/v1/patients/:id/link-clinic` | NAKES (scope), ADMIN | Tautkan pasien existing ke Puskesmas |
| POST | `/v1/patients/:id/verification-instructions` | NAKES (scope), ADMIN | Kirim ulang instruksi OTP |

**GET /v1/patients/lookup — 200:**
```json
{
  "data": {
    "hasConflict": true,
    "matches": [
      {
        "kind": "OUT_OF_SCOPE",
        "patientId": null,
        "fullName": null,
        "maskedPhone": "********0002",
        "status": null,
        "primaryPuskesmasName": null,
        "matchedOn": "PHONE",
        "hint": "Nomor ini sudah dipakai akun lain, tetapi di luar wilayah penugasan Anda. Hubungi admin untuk menautkannya."
      }
    ]
  }
}
```

`kind` menentukan quanto data yang boleh dilihat:

| kind | Arti | Data yang ditampilkan |
|---|---|---|
| `IN_SCOPE` | Pasien dalam wilayah pemanggil | id, nama, nomor disamarkan, status, Puskesmas |
| `OUT_OF_SCOPE` | Akun ada di luar wilayah | **hanya** nomor disamarkan + `hint` |
| `NOT_A_PATIENT` | Nomor milik akun non-pasien | **hanya** nomor disamarkan + `hint` |

Pencarian sengaja tidak dibatasi scope supaya duplikasi tetap terdeteksi, tapi kebocoran
dibatasi pada "ada akun di nomor ini". Nakes cukup tahu harus menyiapkan konteks ke admin
tanpa memperoleh akses ke record yang bukan miliknya. Nomor selalu disamarkan
(empat digit terakhir saja) supaya operator bisa mencocokkan tanpa menyalin data.

Kecocokan pada nomor **dan** NIK di akun yang sama digabung menjadi satu entri.

#### Status operasional & aktivasi

`status` menentukan apakah pasien boleh disentuh sistem: hanya `ACTIVE` yang diproses
scheduler reminder/eskalasi. `ONBOARDING`, `INACTIVE`, dan `BLOCKED` tidak menerima
pesan apa pun, berapa pun resep dan jadwal yang sudah disetujui.

**GET /v1/patients/:id/activation — 200:**
```json
{
  "data": {
    "ready": false,
    "checks": [
      { "key": "PUSKESMA", "label": "Puskesmas utama ditunjuk dan aktif", "satisfied": true, "detail": null, "fixPath": null },
      { "key": "ESCALATION_CONTACT", "label": "Kontak eskalasi tersedia", "satisfied": false,
        "detail": "Minimal satu kontak keluarga atau kontak nakes yang bisa menerima alert.",
        "fixPath": "/patients" }
    ],
    "blockers": [ { "key": "ESCALATION_CONTACT", "detail": "Minimal satu kontak keluarga atau kontak nakes yang bisa menerima alert." } ]
  }
}
```

Kunci checklist: `PUSKESMA`, `CONSENT`, `VERIFIED`, `MINIMUM_DATA`, `ESCALATION_CONTACT`,
`APPROVED_MEDICATION`, `ACTIVE_SCHEDULE`. Daftar lengkap prasyarat ada di
[docs/DATABASE.md §3.2](DATABASE.md#32-patients).

**POST /v1/patients/:id/activate — 200:**
```json
{ "data": { "id": "p1", "status": "ACTIVE", "checklist": { "ready": true, "checks": [], "blockers": [] } } }
```

**400 bila prasyarat belum lengkap** — `details.blockers` berisi daftar yang sama supaya
UI bisa menautkan operator ke layar perbaikannya:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Pasien belum memenuhi syarat aktivasi",
    "details": {
      "blockers": [
        { "key": "APPROVED_MEDICATION", "label": "Minimal satu resep disetujui dokter/bidan",
          "detail": "Belum ada resep berstatus APPROVED. Resep DRAFT tidak boleh diproses.",
          "fixPath": "/patients" }
      ]
    }
  }
}
```

**POST /v1/patients/:id/verification-instructions — 200:**
```json
{
  "data": {
    "patientId": "p1",
    "maskedPhone": "********0001",
    "otpExpiresAt": "2026-08-16T10:05:00.000Z",
    "retryAfterSec": 30,
    "instructionsSent": true
  }
}
```

Endpoint ini **tidak pernah** menandai pasien sebagai terverifikasi — hanya
`POST /v1/auth/otp/verify` yang boleh. Cooldown-nya sama dengan login OTP
(`OTP_RESEND_COOLDOWN_SEC`), jadi form pendaftaran tidak bisa dipakai membanjiri
WhatsApp pasien. Nomor yang sudah terverifikasi ditolak `403`.

Checklist dihitung ulang di server pada setiap panggilan — UI tidak pernah boleh
memutuskan. Perawat dan kader **tidak** boleh mengaktifkan pasien (`403`); mereka boleh
melengkapi data, menambah keluarga, dan membuat draft resep.

**PATCH /v1/patients/:id/status — Request:**
```json
{ "status": "INACTIVE", "reason": "Sedang dirawat di luar wilayah" }
```

Menuju `ACTIVE` ditolak `400` — harus lewat `/activate` supaya checklist tidak bisa
dilewati. Transisi yang tidak ada di peta (§DATABASE 3.2) juga ditolak `400`.

**GET /v1/patients/me — 200:**
```json
{
  "data": {
    "id": "p1",
    "fullName": "Bu Ratna",
    "phone": "0812xxxxxxx",
    "livingSituation": "ALONE",
    "hasNearbyFamily": false,
    "healthConditions": ["DIABETES", "HYPERTENSION"],
    "districtCode": "3471",
    "voiceEnabled": true,
    "smartwatchEnabled": true,
    "riskLevel": "HIGH",
    "emergencyPreference": "NAKES_FIRST"
  }
}
```

### 3.2 Obat & Jadwal

> **Persetujuan klinis.** Resep berstatus `DRAFT` **tidak berjalan**: tidak ada reminder, tidak ada konfirmasi, tidak ada eskalasi. Hanya `DOKTER`/`BIDAN` (atau `ADMIN`) yang dapat menaikkan status ke `APPROVED`, dan hanya `APPROVED` yang mengaktifkan jadwal. Alasannya: keputusan dosis dan jadwal yang keliru dapat menimbulkan false alarm atau gagal mendeteksi bahaya.

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/medications` | PATIENT | Daftar obat (hanya yang `APPROVED`) |
| GET | `/v1/patients/:id/medications` | NAKES (scope), ADMIN | Daftar obat + status persetujuan |
| POST | `/v1/patients/:id/medications` | NAKES (scope), ADMIN | **Buat draft resep** (perawat/bidan) |
| POST | `/v1/patients/:id/schedules` | NAKES (scope), ADMIN | Tambah jadwal pada obat yang ada |
| POST | `/v1/medications/:id/approve` | NAKES **DOKTER/BIDAN**, ADMIN | **Setujui / tolak resep** |
| PUT | `/v1/medications/:id` | NAKES (scope) | Update obat (belum terimplementasi) |
| PUT | `/v1/schedules/:id` | NAKES, PATIENT | Update jadwal (belum terimplementasi) |
| PUT | `/v1/schedules/:id/toggle` | PATIENT, NAKES | Aktif/nonaktif (belum terimplementasi) |

**POST /v1/patients/:id/medications — Request:**
```json
{
  "name": "Metformin",
  "dosage": "500 mg",
  "form": "TABLET",
  "instructions": "Sesudah makan",
  "startedAt": "2026-08-01"
}
```
**Response 201:** objek obat `status: "DRAFT"`, `isActive: false`.

**POST /v1/medications/:id/approve — Request:**
```json
{ "decision": "APPROVED", "note": "Dosis sesuai SOAP" }
```
`decision`: `APPROVED` | `REJECTED`. Obatnya **dan seluruh jadwalnya** diperbarui bersama dalam satu operasi — jadwal yang tertinggal `DRAFT` sementara obatnya aktif akan membuat pasien mendapat pengingat obat yang belum disetujui.

Perubahan status yang sudah final ditolak: menyetujui ulang obat `APPROVED` → `409`; menyetujui ulang yang `REJECTED` → `422`.

Jadwal yang dibuat pada obat yang **sudah** `APPROVED` langsung aktif — keputusan klinis sudah diberikan pada obat induknya, jadi tidak perlu persetujuan kedua. Jadwal pada obat `REJECTED` ditolak `422`.

**POST /v1/patients/:id/schedules — Request:**
```json
{
  "medicationId": "6f1a1e7c-3f1c-4a2b-9c1d-2b7a5e0d1a01",
  "timeOfDay": "08:00",
  "daysOfWeek": [1,2,3,4,5,6,7],
  "dailyFrequency": 1,
  "doseQty": "1 tablet",
  "startDate": "2026-08-01",
  "timeWindowMinutes": 30
}
```
**Response 201:** objek obat induk + jadwal; `nextFireAt` hanya terisi bila jadwalnya benar-benar aktif.
- `daysOfWeek` kosong / tidak dikirim = setiap hari. `dailyFrequency` default `1`.


### 3.3 Reminder & Konfirmasi (Fitur 1–3)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/reminders` | PATIENT | Riwayat reminder (status, waktu) |
| POST | `/v1/compliance/confirm` | PATIENT | Konfirmasi "sudah minum" (app) |
| POST | `/v1/compliance/defer` | PATIENT | "Tunda 15 menit" |
| GET | `/v1/patients/me/compliance` | PATIENT, FAMILY(scope) | Riwayat kepatuhan (belum terimplementasi) |
| GET | `/v1/patients/:id/compliance` | NAKES (scope), ADMIN | **Riwayat kepatuhan versi nakes** |

**GET /v1/patients/:id/compliance** adalah sisi nakes dari endpoint di atas: setiap kali pasien menekan "sudah minum" lewat WhatsApp maupun tombol di aplikasi, hasilnya tampil di sini sebagai `CONFIRMED` / `CONFIRMED_LATE`, sehingga perawat dan dokter bisa melihat kepatuhan per pasien tanpa menghitung ulang dari agregat dashboard.

**POST /v1/compliance/defer** — "Belum siap / tunda N menit" (FR-2.4 / AC-2.4).
Body: `{ "scheduleId": uuid, "minutes": 15 }` — `minutes` opsional (5–120, default `COMPLIANCE_DEFER_MINUTES`).

Effek:
- slot jatuh tempo terakhir dicatat di `compliance_logs` dengan status **`TUNDA`** (bukan `PENDING`), supaya angka adherence tidak menghitungnya sebagai "belum dijawab";
- reminder susulan dijadwalkan ulang pada `now + minutes`;
- **run eskalasi dibiarkan terbuka** — menunda bukan berarti minum, jadi alarm tetap berbunyi bila pasien akhirnya tidak minum (FR-3.1).

Bila slot yang sama lalu dikonfirmasi ("berubah pikiran"), baris `TUNDA` yang sama **dinaikkan** menjadi `CONFIRMED`/`CONFIRMED_LATE` — bukan ditolak `409`. Tanpa itu "Tunda" menjadi jebakan, karena konfirmasi berikutnya selalu gagal.

Response 200: `{ logId, scheduleId, scheduledAt, status, deferredUntil, minutes, alreadyDeferred, escalationRunId }`

Query: `from`, `to` (ISO date), `status`, `limit` (default 50, maks 200), `offset`.

**Response 200:**
```json
{
  "data": [
    {
      "id": "1f0c7b2e-...",
      "scheduledAt": "2026-10-09T00:00:00Z",
      "confirmedAt": "2026-10-09T00:05:00Z",
      "status": "CONFIRMED",
      "channel": "WHATSAPP",
      "medicationName": "Amlodipine",
      "scheduleId": "00000000-0000-4000-8000-000000000302",
      "timeOfDay": "07:00",
      "doseQty": "1 tablet"
    }
  ],
  "meta": {
    "total": 7,
    "pageSize": 50,
    "page": 1,
    "summary": {
      "confirmed": 4,
      "confirmedLate": 1,
      "missed": 2,
      "pending": 0,
      "adherenceRate": 0.71
    }
  }
}
```
`summary.adherenceRate` = `(confirmed + confirmedLate) / (confirmed + confirmedLate + missed)`. `CONFIRMED_LATE` tetap dihitung procuring diminum (AC-2.3), bukan incumplimiento.

**POST /v1/compliance/confirm — Request:**
```json
{ "scheduleId": "9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30", "channel": "IN_APP" }
```
**Response 200:**
```json
{
  "data": {
    "logId": "1f0c7b2e-5d43-4a91-8e6c-7b0a9d3f2e58",
    "scheduleId": "9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30",
    "scheduledAt": "2026-08-16T01:00:00Z",
    "status": "CONFIRMED",
    "confirmedAt": "2026-08-16T01:12:00Z",
    "escalationCancelled": true,
    "escalationRunId": "5b7e1c40-9a2f-4d18-8c33-2e6f0d1a4b90"
  }
}
```
- `channel` menerima subset `Channel`: `IN_APP` (default), `WHATSAPP`, `VOICE`.
- **Slot yang dikonfirmasi** ditentukan server, bukan dikirim klien: slot jatuh tempo terakhir pada
  jadwal tersebut, dihitung dari `timeOfDay` + zona waktu pasien. Kalau tidak ada slot jatuh tempo
  dalam batas keterlambatan → `422 INVALID_TRANSITION`.
- **Klasifikasi status** — `scheduledAt` adalah waktu jadwal, `confirmedAt` waktu tombol ditekan:
  - `CONFIRMED` — ditekan pada atau dalam `timeWindowMinutes` jadwal (batas inklusif).
  - `CONFIRMED_LATE` — ditekan setelah time window, tetapi masih di bawah batas keterlambatan.
    Status tidak pernah menjadi `MISSED` dari endpoint ini; `MISSED` adalah hasil scheduler.
- **Batas keterlambatan** dikonfigurasi lewat `COMPLIANCE_CONFIRM_MAX_LATE_MINUTES`
  (default `1440` = 24 jam, rentang 5–10080). Di atas itu → `422 INVALID_TRANSITION`.
- **Idempoten** dijamin unique index `compliance_logs (schedule_id, scheduled_at)`, bukan
  pengecekan di aplikasi — dua permintaan bersamaan tetap menghasilkan satu record.
  Konfirmasi ganda → `409 ALREADY_PROCESSED` dengan `details.logId` record yang sudah ada.
  Percobaan ulang tetap mencoba menutup run eskalasi yang mungkin gagal ditutup sebelumnya.
- **Eskalasi**: jika ada `escalation_runs` aktif untuk jadwal tersebut, event `PATIENT_CONFIRMED`
  menutupnya menjadi `RESOLVED` dengan `resolution_type = PATIENT_CONFIRMED`
  (`escalationCancelled: true`, `escalationRunId` terisi).
- **Role hanya `PATIENT`** dan jadwal harus milik pasien itu sendiri (`403` kalau bukan).
  Nakes/admin tidak boleh dicatat lewat endpoint ini karena konfirmasi adalah bukti pasien
  minum obat sendiri; konfirmasi oleh petugas dicatat lewat modul `compliance` yang relevan.
- **Konfirmasi via WhatsApp** masuk lewat webhook (lihat §6) — bukan endpoint ini.

#### GET `/v1/patients/me/reminders` — jadwal obat milik pasien sendiri

Role: PATIENT, FAMILY. Sumber data layar "Sudah minum" di aplikasi pasien.

```json
{
  "data": [
    {
      "id": "s1",
      "medicationName": "Metformin 500mg",
      "dosage": "500 mg",
      "instructions": "Sesudah makan",
      "doseQty": "1 tablet",
      "timeOfDay": "08:00",
      "daysOfWeek": [],
      "startDate": "2026-01-01",
      "endDate": null,
      "nextFireAt": "2026-08-17T01:00:00.000Z"
    }
  ]
}
```

`nextFireAt` dihitung di server memakai zona waktu pasien, jadi aplikasi tidak perlu
menghitung ulang jam dinding. `id` selalu berasal dari server — aplikasi tidak pernah
memakai UUID dummy, sehingga konfirmasi tidak mungkin jatuh ke jadwal orang lain.

Query hanya mengambil jadwal yang **obat dan jadwalnya sama-sama `APPROVED` serta
aktif**. `patientId` tidak pernah diterima dari query maupun body.

### 3.4 Vital & Anomali (Fitur 4)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| POST | `/v1/vitals` | SMARTWATCH_SERVICE (service token) | Ingest event vital (dari smartwatch adapter) |
| GET | `/v1/patients/me/vitals` | PATIENT, NAKES (scope) | Riwayat vital |
| PUT | `/v1/patients/:id/hr-thresholds` | NAKES **DOKTER/BIDAN**, ADMIN | **Ambang detak jantung per pasien** |
| POST | `/v1/dev/mock-anomaly` | (dev only) | Trigger anomali sintetis untuk demo |

**PUT /v1/patients/:id/hr-thresholds — Request:**
```json
{ "hrMinBpm": 45, "hrMaxBpm": 130 }
```
Menetapkan ambang detak jantung individual pasien. Hanya dokter atau bidan yang boleh — ambang yang terlalu rapat memicu false alarm, terlalu longgar justru lethalling bahaya (lihat §3.2). Perawat dapat membaca nilai ini tetapi tidak mengubahnya. `hrMinBpm >= hrMaxBpm` ditolak `400`; mengirim keduanya `null` (atau mengosongkan keduanya) ditolak agar ambang default sistem tidak terhapus diam-diam.

Bila kolom kosong, deteksi anomali memakai default sistem dari `ANOMALY_HR_MIN` / `ANOMALY_HR_MAX`. Nilai per pasien menggantikan default tersebut, sementara `ANOMALY_WINDOW_SEC` tetap global.

> Sebelumnya ambang per pasien dititipkan sebagai teks bebas di `healthConditions` (mis. `"max_hr:130"`) lalu diparse regex. Format bebas seperti itu tidak bisa dibedakan mana yang disahkan dokter, sehingga digantikan kolom eksplisit ini.

**POST /v1/vitals — Request:**
```json
{
  "patientId": "p1",
  "recordedAt": "2026-08-16T02:00:00Z",
  "source": "MOCK",
  "hrBpm": 145,
  "spo2": 97,
  "rawPayload": {}          // dianonimkan sebelum disimpan
}
```
**Response 200:**
```json
{
  "data": {
    "id": "v1",
    "vitalId": "v1",
    "status": "RECORDED",      // atau "DUPLICATE_IGNORED" saat event ganda (AN-6)
    "isAnomalous": false,
    "anomalyReason": null,
    "recordedAt": "2026-08-16T02:00:00.000Z"
  }
}
```
- **Catatan Teknis (CL-201)**:
  - Validasi eligibilitas: Pasien wajib mengaktifkan smartwatch (`smartwatchEnabled: true`). Jika tidak, permintaan ditolak HTTP 403 (AN-5).
  - Sanitasi: `rawPayload` otomatis dibersihkan dari metadata perangkat keras (ID perangkat, serial number, IMEI, MAC address, token) sebelum disimpan (UU PDP).
  - Deduplikasi (AN-6): Event dengan kombinasi `(patientId, source, recordedAt)` yang sama bersifat idempoten (mengembalikan data yang sudah ada tanpa menduplikasi baris di DB).

**POST /v1/dev/mock-anomaly (Dev Only — CL-203) — Request:**
```json
{
  "patientId": "11111111-1111-4111-8111-111111111111", // opsional, default pasien smartwatch aktif
  "type": "HIGH_HR",                                    // "HIGH_HR" | "LOW_HR" | "SPIKE" | "NORMAL"
  "hrBpm": 145,                                         // opsional
  "intervalSec": 20                                     // jeda bacaan dalam detik (default 20s)
}
```
**Response 200:**
```json
{
  "data": {
    "triggered": true,
    "patientId": "11111111-1111-4111-8111-111111111111",
    "type": "HIGH_HR",
    "readingsCount": 2,
    "isAnomalous": true,
    "anomalyReason": "hr>120",
    "vitalIds": ["vital_1", "vital_2"]
  }
}
```
- Endpoint ini dilindungi guard dan **hanya aktif di lingkungan non-production** (`NODE_ENV !== 'production'`). Di production, route mengembalikan HTTP 404 Not Found (AGENTS.md §8).

### 3.5 Darurat (Fitur 4, 7)

- **Pemicu Otomatis (CL-204 / AC-4.1)**:
  - Anomali tanda vital berurutan (≥2 bacaan abnormal dalam 60s dari `/v1/vitals` atau `/v1/dev/mock-anomaly`) otomatis membuat record `EmergencyAlert` dengan status `PENDING_PATIENT_CONFIRM`.
  - Sistem memulai `EscalationRun` baru dengan context `EMERGENCY` dan status `WAITING_PATIENT` (CL-109).
  - Pesan konfirmasi darurat "Apakah Anda aman?" otomatis dikirim ke nomor WhatsApp pasien (CL-102) dan notifikasi in-app dibuat pada tabel `Notification` dengan payload respons darurat.
  - Timer timeout konfirmasi darurat (30–60 detik, default 45s dari `EMERGENCY_PATIENT_CONFIRM_SEC`) otomatis dijadwalkan pada queue adapter.
  - Insiden dicatat ke audit log dengan action `emergency.triggered` (CL-010).

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/emergencies/active` | NAKES (scope) | Daftar alert aktif (`PENDING_PATIENT_CONFIRM`, `ESCALATING`) |
| GET | `/v1/emergencies/:id` | PATIENT, FAMILY(scope), NAKES(scope) | Detail status alert darurat dan eskalasi terkait |
| POST | `/v1/emergencies/:id/patient-response` | PATIENT | Pasien jawab "Saya aman" → resolusi (CL-205) |
| POST | `/v1/emergencies/:id/timeout` | PATIENT, NAKES, ADMIN, INTERNAL | Pemicu timeout darurat (kirim alert WA keluarga/nakes + GPS + 112) (CL-206) |
| GET | `/v1/emergencies` | NAKES (scope), ADMIN | Feed riwayat alert (filter status) |

**GET /v1/emergencies/active — Response 200:**
```json
{
  "data": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "patientId": "11111111-1111-4111-8111-111111111111",
      "status": "PENDING_PATIENT_CONFIRM",
      "triggerType": "ANOMALY_HR",
      "hrBpm": 145,
      "triggeredAt": "2026-08-16T02:00:00.000Z",
      "patient": {
        "user": {
          "id": "22222222-2222-4222-8222-222222222222",
          "fullName": "Bu Siti Test",
          "phone": "081234567890"
        }
      },
      "escalationRun": {
        "id": "44444444-4444-4444-8444-444444444444",
        "status": "WAITING_PATIENT"
      }
    }
  ]
}
```

**GET /v1/emergencies/:id — Response 200:**
```json
{
  "data": {
    "id": "33333333-3333-4333-8333-333333333333",
    "patientId": "11111111-1111-4111-8111-111111111111",
    "status": "PENDING_PATIENT_CONFIRM",
    "triggerType": "ANOMALY_HR",
    "hrBpm": 145,
    "triggeredAt": "2026-08-16T02:00:00.000Z",
    "patient": {
      "user": {
        "fullName": "Bu Siti Test",
        "phone": "081234567890"
      }
    },
    "escalationRun": {
      "id": "44444444-4444-4444-8444-444444444444",
      "status": "WAITING_PATIENT",
      "steps": []
    }
  }
}
```

**POST /v1/emergencies/:id/patient-response — Request:**
```json
{ "response": "SAFE" }
```
**Response 200:**
```json
{ "data": { "emergencyId": "e1", "status": "RESOLVED_SAFE", "escalationRunId": null } }
```
- Menyediakan `response: SAFE | NEED_HELP` (NEED_HELP → lanjut eskalasi langsung).

**POST /v1/emergencies/:id/timeout — Request (opsional):**
```json
{ "notes": "Timeout konfirmasi pasien 45 detik tercapai" }
```
**Response 200:**
```json
{
  "data": {
    "emergencyId": "33333333-3333-4333-8333-333333333333",
    "status": "ESCALATING",
    "hasLocation": true,
    "locationLat": "-6.2088000",
    "locationLng": "106.8456000",
    "notifiedFamilyCount": 2,
    "notifiedNakesCount": 0,
    "tel112": "tel:112",
    "alertSentToFamilyAt": "2026-08-16T02:00:45.000Z"
  }
}
```
- Mengirim pesan WhatsApp ke seluruh kontak keluarga aktif terurut tier dengan link Google Maps dan nomor darurat `tel:112` (one-tap call manual, tanpa auto-dial).
- Jika pasien tinggal sendiri (`livingSituation = ALONE`) tanpa kontak keluarga tier-1, alert darurat langsung dieskalasi ke kontak nakes pembina (`alertSentToNakesAt`) dan notifikasi dashboard prioritas tinggi.

### 3.6 Eskalasi (Fitur 3, 7 — CL-207)

- **Alur Eskalasi Bertingkat (AC-7.1..7.5)**:
  - Urutan eskalasi: `WAITING_PATIENT` (default 30m / emergency 45s) → `FAMILY_TIER_1` (default 15m) → `FAMILY_TIER_2` (default 15m) → `NAKES` (default 30m) → `TIMED_OUT`.
  - **Timeout Configurable (AC-7.5)**: Nilai default dapat diubah per pasien melalui `configSnapshot` (`patientWaitSec`, `tier1WaitSec`, `tier2WaitSec`, `nakesWaitSec`).
  - **Skip Tier Kosong (AC-7.3 / ES-7 / ES-8)**: Pasien tanpa kontak Tier 1 otomatis langsung masuk ke Tier 2; pasien tanpa kontak keluarga (T1 & T2) langsung dialihkan ke NAKES.
  - **Penghentian Eskalasi (AC-7.2)**: Respons `HANDLE` oleh keluarga atau nakes pada tier mana pun langsung mengubah status run menjadi `HANDLED` dan membatalkan eskalasi ke tier berikutnya.
  - **Pencatatan Transisi (AC-7.4)**: Setiap transisi status, pengiriman alert WhatsApp, dan respons tercatat di tabel `escalation_steps` serta `audit_logs`.

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/escalations/active` | PATIENT, FAMILY | Run eskalasi aktif milik saya |
| GET | `/v1/escalations/:id` | PATIENT, FAMILY(scope), NAKES(scope) | Detail run + steps |
| POST | `/v1/escalations/:id/respond` | FAMILY, NAKES | Keluarga/nakes merespons (handle/looking) |
| GET | `/v1/escalations/:runId/steps` | NAKES (scope) | Log steps lengkap |

**GET /v1/escalations/active — Response 200:**
```json
{
  "data": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "patientId": "11111111-1111-4111-8111-111111111111",
      "context": "SCHEDULE",
      "status": "FAMILY_TIER_1",
      "currentTier": "TIER_1",
      "startedAt": "2026-08-16T08:00:00.000Z",
      "steps": [
        {
          "id": "step-1",
          "tier": "TIER_1",
          "messageKey": "alert.family.tier_1",
          "contactPhone": "081299990001",
          "sentAt": "2026-08-16T08:30:00.000Z"
        }
      ],
      "patient": {
        "id": "11111111-1111-4111-8111-111111111111",
        "nik": "3471010000000001",
        "livingSituation": "WITH_FAMILY",
        "emergencyPreference": "FAMILY_FIRST",
        "user": {
          "fullName": "Bu Siti Test",
          "phone": "081234567890"
        }
      }
    }
  ]
}
```

**GET /v1/escalations/:id — Response 200:**
```json
{
  "data": {
    "id": "44444444-4444-4444-8444-444444444444",
    "patientId": "11111111-1111-4111-8111-111111111111",
    "context": "SCHEDULE",
    "status": "FAMILY_TIER_1",
    "currentTier": "TIER_1",
    "startedAt": "2026-08-16T08:00:00.000Z",
    "resolvedAt": null,
    "resolutionType": null,
    "steps": [
      {
        "id": "step-1",
        "tier": "TIER_1",
        "channel": "WHATSAPP",
        "messageKey": "alert.family.tier_1",
        "contactPhone": "081299990001",
        "sentAt": "2026-08-16T08:30:00.000Z"
      }
    ],
    "patient": {
      "id": "11111111-1111-4111-8111-111111111111",
      "nik": "3471010000000001",
      "livingSituation": "WITH_FAMILY",
      "emergencyPreference": "FAMILY_FIRST"
    },
    "resolvedByUser": null
  }
}
```

**POST /v1/escalations/:id/respond — Request:**
```json
{ "response": "HANDLE", "note": "Saya akan ke rumah Bu Ratna sekarang" }
```
**Response 200:**
```json
{
  "data": {
    "runId": "44444444-4444-4444-8444-444444444444",
    "status": "HANDLED",
    "resolvedBy": "22222222-2222-4222-8222-222222222222",
    "resolutionType": "FAMILY_HANDLED",
    "remainingTiersCancelled": true
  }
}
```
- Opsi `response: "LOOKING"` mencatat pengakuan tanpa menghentikan timeout.
- Transisi invalid (run sudah berstatus final `HANDLED`, `RESOLVED`, `TIMED_OUT`) → `422 INVALID_TRANSITION`.

**GET /v1/escalations/:runId/steps — Response 200:**
```json
{
  "data": [
    {
      "id": "step-1",
      "runId": "44444444-4444-4444-8444-444444444444",
      "tier": null,
      "channel": "WHATSAPP",
      "messageKey": "reminder.metformin",
      "contactPhone": "081234567890",
      "sentAt": "2026-08-16T08:00:00.000Z",
      "response": "NONE"
    },
    {
      "id": "step-2",
      "runId": "44444444-4444-4444-8444-444444444444",
      "tier": "TIER_1",
      "channel": "WHATSAPP",
      "messageKey": "alert.family.tier_1",
      "contactPhone": "081299990001",
      "sentAt": "2026-08-16T08:30:00.000Z",
      "response": "NONE"
    }
  ]
}
```

### 3.7 Kontak Keluarga & Nakes

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/family-contacts` | PATIENT | Daftar kontak keluarga milik sendiri |
| POST | `/v1/patients/me/family-contacts` | PATIENT | Tambah kontak (pasien sendiri) |
| POST | `/v1/patients/:id/family-contacts` | NAKES (scope), ADMIN | Tambah kontak untuk pasien dalam scope |
| PUT | `/v1/family-contacts/:id` | PATIENT (milik sendiri), NAKES (scope), ADMIN | Update tier/prioritas/aktif |
| DELETE | `/v1/family-contacts/:id` | PATIENT (milik sendiri), NAKES (scope), ADMIN | Hapus kontak |
| POST | `/v1/family-contacts/:id/verify` | PATIENT (milik sendiri), NAKES (scope), ADMIN | Verifikasi nomor agar aktif menerima alert |
| GET | `/v1/patients/:id/nakes-contacts` | NAKES (scope), PATIENT | Daftar nakes pasien (dibaca lewat `GET /v1/patients/:id`) |
| POST | `/v1/patients/:id/nakes-contacts` | NAKES(scope) | Assign nakes/kader (belum terimplementasi) |

Endpoint `/me` hanya untuk PATIENT: path itu menunjuk akun pemanggil, dan akun nakes tidak punya profil pasien. Nakes & admin memakai path `/v1/patients/:id/...`, yang patientId-nya diverifikasi terhadap scope nakes.

**POST /v1/patients/me/family-contacts — Request:**
```json
{
  "name": "Sari",
  "phone": "0813xxxxxxx",
  "relationship": "KEPONAKAN",
  "tier": "TIER_1",
  "priority": 1,
  "isNearby": true,
  "canReceiveEmergency": true,
  "canViewHealth": true
}
```
**Response 201:** kontak + `verificationStatus: PENDING` (perlu verifikasi nomor sebelum aktif menerima alert).

### 3.8 Dashboard Nakes (Fitur 5, 12)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/dashboard/summary` | NAKES (scope) | Ringkasan: total pasien, adherence, eskalasi aktif, darurat |
| GET | `/v1/dashboard/adherence` | NAKES (scope) | Seri data kepatuhan (grafik) harian & per jenis penyakit |
| GET | `/v1/dashboard/risk-patients` | NAKES (scope) | Pasien berisiko tinggi (skor >= 70 / HIGH) |
| GET | `/v1/dashboard/alerts` | NAKES (scope) | Stream alert darurat & eskalasi aktif |
| GET | `/v1/dashboard/work-queue` | NAKES (scope), ADMIN | Antrean kerja: pasien yang menunggu tindakan (lihat §3.8b) |

**Query Parameters Filter (CL-210 / FR-5.2 / AC-5.2 / AC-5.3):**
Didukung di seluruh endpoint dashboard (`/summary`, `/adherence`, `/risk-patients`, `/alerts`):
- `district` (string, opsional): Kode distrik / kelurahan pasien (misal `3471`). Nakes dibatasi hanya pada wilayah binaannya (AC-5.3; jika mengakses distrik di luar binaan mengembalikan hasil kosong, bukan membocorkan data).
- `disease` (string, opsional): Jenis penyakit (misal `DIABETES`, `HYPERTENSION`), case-insensitive.
- `from` (string tanggal `YYYY-MM-DD` atau ISO datetime, opsional): Batas awal rentang tanggal.
- `to` (string tanggal `YYYY-MM-DD` atau ISO datetime, opsional): Batas akhir rentang tanggal (`from <= to`).
- `escalationStatus` (string, opsional): Filter status eskalasi aktif (misal `FAMILY_TIER_1`, `FAMILY_TIER_2`, `NAKES`).

**GET /v1/dashboard/summary — 200:**
```json
{
  "data": {
    "totalPatients": 120,
    "adherenceRate": 0.88,
    "confirmedCount": 105,
    "confirmedLateCount": 12,
    "missedCount": 15,
    "pendingCount": 8,
    "activeEmergencies": 2,
    "activeEscalations": 3,
    "atRiskPatients": 5,
    "trends": {
      "dailyRate": 0.88,
      "weeklyRate": 0.86,
      "direction": "UP"
    }
  }
}
```

**GET /v1/dashboard/adherence — 200:**
```json
{
  "data": {
    "period": { "from": "2026-08-01", "to": "2026-08-16" },
    "series": [
      { "date": "2026-08-01", "adherenceRate": 0.91, "confirmed": 82, "missed": 8, "total": 90 },
      { "date": "2026-08-02", "adherenceRate": 0.87, "confirmed": 78, "missed": 12, "total": 90 }
    ],
    "byDisease": [
      { "disease": "DIABETES", "adherenceRate": 0.89, "total": 120 },
      { "disease": "HYPERTENSION", "adherenceRate": 0.84, "total": 95 }
    ]
  }
}
```

**GET /v1/dashboard/risk-patients — 200:**
```json
{
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "fullName": "Bu Ratna",
      "phone": "081234567890",
      "districtCode": "3471",
      "livingSituation": "ALONE",
      "healthConditions": ["DIABETES", "HYPERTENSION"],
      "riskScore": 82,
      "riskLevel": "HIGH",
      "adherenceRate": 0.55,
      "missedDosesLastWeek": 3
    }
  ]
}
```

**GET /v1/dashboard/alerts — 200:**
```json
{
  "data": {
    "emergencies": [
      {
        "id": "em-01",
        "patientId": "11111111-1111-4111-8111-111111111111",
        "patientName": "Bu Ratna",
        "triggerType": "ANOMALY_HR",
        "hrBpm": 145,
        "status": "ESCALATING",
        "triggeredAt": "2026-08-16T02:01:00.000Z",
        "location": { "lat": -7.79, "lng": 110.37 },
        "puskesmasId": "psk-1",
        "districtCode": "3471"
      }
    ],
    "escalations": [
      {
        "id": "esc-01",
        "patientId": "11111111-1111-4111-8111-111111111111",
        "patientName": "Bu Ratna",
        "context": "SCHEDULE",
        "status": "FAMILY_TIER_1",
        "currentTier": "TIER_1",
        "startedAt": "2026-08-16T08:00:00.000Z"
      }
    ],
    "totalActive": 2
  }
}
```

### 3.8b Antrean Kerja Nakes

`GET /v1/dashboard/work-queue` — Role: NAKES (scope), ADMIN.

Berbeda dari `/summary` yang berupa statistik, endpoint ini mengembalikan **daftar pasien
yang menunggu tindakan**, dikelompokkan menurut tindakan itu. Semua query memakai filter
scope yang sama dengan dashboard utama, jadi work queue tidak pernah menampilkan pasien
milik puskesmas lain.

| Query | Deskripsi |
|---|---|
| `district` / `disease` | Sama seperti filter dashboard |
| `clinicId` | Saring ke satu puskesmas penanggung jawab |
| `limit` | Item per kelompok (default 10, maks 50) |

```json
{
  "data": [
    {
      "key": "UNVERIFIED",
      "label": "Menunggu verifikasi WhatsApp",
      "description": "Nomor belum diverifikasi lewat OTP, jadi pasien belum bisa diaktifkan.",
      "count": 2,
      "items": [
        {
          "patientId": "p1",
          "fullName": "Bu Ratna",
          "phone": "081200000001",
          "status": "ONBOARDING",
          "primaryPuskesmasName": "Puskesmas Umbulharjo",
          "reasons": ["Nomor WhatsApp belum terverifikasi"]
        }
      ]
    }
  ],
  "meta": { "actionablePatients": 5 }
}
```

| `key` | Isi |
|---|---|
| `INCOMPLETE` | Data minimum pasien belum lengkap (field yang kosong disebut di `reasons`) |
| `UNVERIFIED` | Nomor WhatsApp belum diverifikasi |
| `NO_ESCALATION_CONTACT` | Tidak ada kontak keluarga maupun nakes yang bisa menerima alert |
| `NO_APPROVED_MEDICATION` | Belum ada resep berstatus `APPROVED` |
| `NO_ACTIVE_SCHEDULE` | Resep `APPROVED` ada tapi belum punya jadwal aktif |
| `ACTIVE_ESCALATION` | Jumlah eskalasi yang belum selesai |
| `OPEN_EMERGENCY` | Jumlah darurat yang belum ditangani |

Dua kelompok terakhir **sengaja `items: []`**: yang dibutuhkan di sana adalah banyaknya
insiden, dan penanganannya lewat layar emergency/eskalasi — bukan daftar pasien.

Item pada kelompok onboarding tidak memuat data klinis, hanya identitas, status, puskesmas,
dan alasan. Prinsipnya: work queue menjawab "pasien mana yang perlu saya tangani", bukan
"apa isi rekam medisnya".

Pasien berstatus `ACTIVE` tidak pernah muncul di work queue — antrean ini memang untuk
pasien yang belum selesai diaktifkan.

---

### 3.9 Farmasi — Permintaan & Penyerahan Obat

Alur dua sumber: **rutin** dibuat scheduler otomatis dari resep yang sudah disetujui
dokter (`source: ROUTINE`), dan **permintaan pasien** di luar jadwal yang wajib
lewat persetujuan dokter dulu (`source: PATIENT_REQUEST`).

#### State machine

```
PENDING_DOCTOR ──approve──> QUEUED ──start──> PREPARING ──ready──> READY ──dispense──> DISPENSED
      │                       │                   │                 │
      └──reject──> REJECTED   └──── out_of_stock / substituted ─────┘ (dari tiga status ini)
```

Status final (`DISPENSED`, `REJECTED`, `OUT_OF_STOCK`, `SUBSTITUTED`) tidak punya
transisi keluar. `OVERDUE` **bukan** status — field `isOverdue` dihitung dari
`dueAt` vs hari ini selama status masih aktif.

#### Endpoint

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/medications` | PATIENT, FAMILY | Obat aktif milik sendiri (dasar form "Minta Obat") |
| POST | `/v1/medication-requests` | PATIENT, FAMILY | Ajukan permintaan di luar jadwal |
| GET | `/v1/medication-requests` | FARMASI, DOKTER, BIDAN, ADMIN, PASIEN*(milik sendiri) | Antrean + daftar menunggu dokter |
| GET | `/v1/medication-requests/:id` | idem | Detail + audit trail |
| PATCH | `/v1/medication-requests/:id/decision` | DOKTER, BIDAN | Setujui / tolak |
| PATCH | `/v1/medication-requests/:id/status` | **FARMASI** | Semua aksi penyiapan & penyerahan |
| GET | `/v1/medication-requests/queue-summary` | FARMASI, NAKES, ADMIN | Badge count navbar |
| POST | `/v1/medication-requests/generate-routine` | FARMASI, NAKES, ADMIN | Trigger manual scheduler (demo) |
| GET | `/v1/dispensing-records` | FARMASI, DOKTER, BIDAN, ADMIN | Riwayat penyerahan |
| PATCH | `/v1/medications/:id` | DOKTER, BIDAN | Setujui penggantian obat yang ditandai apotek |

\* `PATIENT`/`FAMILY` melihat hanya miliknya; `patientId` di-pin dari klaim JWT.
Mengirim `patientId` milik orang lain dijawab `403`.

#### POST `/v1/medication-requests`

```jsonc
// req — patientId TIDAK diterima di body, selalu dari klaim JWT
{ "medicationId": "uuid", "requestedQuantity": 30,
  "reasonCode": "MEDICATION_LOST", "reasonNotes": "Kotak obat basah" }
```

Respon `201`:

```jsonc
{ "data": {
  "id": "uuid", "patientName": "Ratna Wijaya",
  "medicationName": "Metformin", "requestedQuantity": 30,
  "source": "PATIENT_REQUEST", "status": "PENDING_DOCTOR",
  "isOverdue": false, "reasonLabel": "Obat hilang",
  "dueAt": "2026-10-14", "quantityRemaining": 3,
  "createdAt": "2026-10-11T08:00:00.000Z" } }
```

Ditolak `422` bila resepnya belum `APPROVED`, sudah dihentikan dokter, atau masa
pakainya habis. Ditolak `400` bila jumlah melebihi `PHARMACY_MAX_DAYS_SUPPLY` atau
sisa stok + satu siklus penuh.

#### PATCH `/v1/medication-requests/:id/decision`

```jsonc
{ "decision": "APPROVED", "approvedQuantity": 20, "note": "Setuju sebagian" }
{ "decision": "REJECTED", "note": "Resep masih stok, ambil 10 hari lagi" }  // note wajib
```

Ditolak `403` bila pemanggil bukan DOKTER/BIDAN/ADMIN. Ditolak `422` bila status
bukan `PENDING_DOCTOR` — termasuk saat sudah pernah diputuskan.

#### PATCH `/v1/medication-requests/:id/status`

```jsonc
{ "action": "START_PREPARING" }
{ "action": "MARK_READY" }
{ "action": "DISPENSED", "quantityDays": 30 }                        // quantityDays wajib
{ "action": "MARK_OUT_OF_STOCK", "reason": "Stok habis di gudang" }  // reason wajib
{ "action": "MARK_SUBSTITUTED", "reason": "Generik habis",
  "substituteName": "Glucophage XR 500 mg" }                         // keduanya wajib
{ "action": "RETURNED_TO_QUEUE" }
```

Ditolak `403` bila pemanggil bukan FARMASI/ADMIN — **dokter dan perawat tidak bisa
menyiapkan obat**. Transisi tidak valid dijawab `422 INVALID_TRANSITION` dengan
pesan yang menyebutkan aksi yang sah dari status tersebut.

`DISPENSED` additionally: membuat `DispensingRecord`, memperbarui
`MedicationStock.quantityRemaining`, dan menggeser `Medication.nextPickupAt`.

#### GET `/v1/medication-requests`

Query: `status`, `source`, `overdue=true|false`, `patientId`, `search`, `limit`, `offset`.

```jsonc
{ "data": [ /* MedicationRequest[] */ ],
  "meta": { "total": 42, "summary": {
    "queued": 12, "preparing": 3, "ready": 5, "overdue": 2, "pendingDoctor": 4 } } }
```

Filter `overdue` diterapkan di server dan tidak pernah menyertakan status final.

#### Notifikasi WhatsApp

Dikirim ke pasien **dan** seluruh kontak keluarga aktif:

| Momen | Pesan |
|---|---|
| Permintaan disetujui | Masuk antrean farmasi |
| Permintaan ditolak | Beserta **alasan dokter** |
| `MARK_READY` | Obat siap diambil |
| `MARK_OUT_OF_STOCK` | Stok habis + alasan |
| `MARK_SUBSTITUTED` | Nama obat penggantinya |

Kegagalan kirim tidak membatalkan transisi status — dicatat sebagai `Notification`
berstatus `FAILED` agar bisa dikirim ulang (pola yang sama dengan reminder & eskalasi).

Scheduler `PHARMACY_REFILL_LEAD_DAYS` hari sebelum tanggal ambil membuat request
`ROUTINE` langsung berstatus `QUEUED`: persetujuan dokter sudah melekat pada resepnya.

#### 3.9 Refill (Fitur 6)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/refill-status` | PATIENT, FAMILY(scope) | Estimasi stok & tanggal habis |
| POST | `/v1/refill/:medicationId/confirm` | PATIENT, FAMILY(scope) | Tandai "sudah ambil obat" |
| GET | `/v1/patients/:id/refill-status` | NAKES (scope) | Per pasien |

### 3.10 Master Data Puskesmas

Puskesmas menentukan cakupan pasien dan siapa yang boleh punya penugasan, jadi
UUID-nya tidak pernah tampil di layar — operator selalu memilih nama.

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/puskesmas` | NAKES (dibatasi penugasan), ADMIN | Daftar untuk dropdown |
| GET | `/v1/puskesmas/:id` | NAKES, ADMIN | Detail satu puskesmas |
| GET | `/v1/puskesmas/districts` | NAKES, ADMIN | Kode wilayah yang tersedia |
| POST | `/v1/admin/puskesmas` | ADMIN | Tambah puskesmas |
| PATCH | `/v1/admin/puskesmas/:id` | ADMIN | Ubah data / aktif-nonaktifkan |

**Scope baca:** NAKES hanya menerima puskesmas dalam penugasannya, dan staf tanpa
penugasan mendapat daftar kosong — bukan seluruh daftar. Tanpa pembatasan ini,
operator bisa mendaftarkan pasien ke puskesmas yang tidak terlihat olehnya, sehingga
pasien itu langsung "hilang" dari dashboard.

Query: `?search=`, `?district=`, `?includeInactive=true` (hanya berlaku untuk ADMIN).

Nama puskesmas tidak boleh duplikat **dalam satu wilayah**. Pengecekan dilakukan di
aplikasi, bukan lewat unique index, karena `district_code` nullable — PostgreSQL
menganggap NULL berbeda dengan NULL sehingga index tidak akan menangkap dua puskesmas
tanpa kode wilayah yang namanya sama.

`is_active: false` tidak menghapus puskesmas: pasien dan riwayat penugasan masih
menunjuk ke sana. Yang dinonaktifkan hanya kemunculannya di pilihan baru.

### 3.11 Edukasi & Skrining (Fitur 8, 9)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/education/topics` | PATIENT | Daftar topik edukasi |
| GET | `/v1/education/topics/:key` | PATIENT | Konten topik |
| POST | `/v1/screenings` | PATIENT | Mulai skrining |
| POST | `/v1/screenings/:id/answers` | PATIENT | Jawab kuesioner |
| POST | `/v1/screenings/:id/submit` | PATIENT | Submit → skor + level |
| GET | `/v1/screenings` | PATIENT, NAKES(scope) | Riwayat skrining |

### 3.12 Faskes Terdekat (Fitur 10)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/facilities/nearby?lat=-7.8&lng=110.3&radius=10&type=PUSKESMAS` | PATIENT | Faskes terdekat |

**200:**
```json
{
  "data": [
    {
      "id": "f1", "name": "Puskesmas Umbulharjo", "type": "PUSKESMAS",
      "address": "Jl. ...", "distanceKm": 2.4, "phone": "0274xxxx",
      "mapsUrl": "https://maps.google.com/?q=-7.8,110.3"
    }
  ]
}
```

### 3.13 Risk Prediction (Fitur 12)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/risk` | PATIENT | Skor + faktor |
| GET | `/v1/patients/:id/risk` | NAKES(scope) | Per pasien |
| POST | `/v1/risk/recompute` | ADMIN (job) | Trigger recompute (biasanya job harian) |

### 3.14 Export Anonim (Fitur 13)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| POST | `/v1/export/jobs` | ADMIN (Dinkes), NAKES (scope) | Buat job export |
| GET | `/v1/export/jobs/:id` | pembuat | Status + URL file |
| GET | `/v1/export/jobs/:id/download` | pembuat | Unduh CSV/JSON (anonim) |

**POST /v1/export/jobs — Request:**
```json
{ "format": "CSV", "filters": { "district": "3471", "disease": "DIABETES", "from": "2026-07-01", "to": "2026-08-01" } }
```
**202:**
```json
{ "data": { "jobId": "ex1", "status": "PENDING", "url": "/v1/export/jobs/ex1" } }
```

### 3.15 Audit (Admin)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/audit-logs` | ADMIN | Query audit log (filter action, actor, date) |

### 3.16 Manajemen Akun (Admin)

Tahap 4 alur: akun **faskes dan nakes** dibuat serta dikelola oleh admin, bukan oleh nakes itu sendiri — sebab peran klinis menentukan siapa yang boleh menyetujui resep, jadi tidak boleh ditetapkan sendiri oleh pihak yang akandorong perubahan itu.

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| POST | `/v1/admin/nakes-accounts` | ADMIN | Buat akun nakes + peran klinis + wilayah awal |
| GET | `/v1/admin/nakes-accounts` | ADMIN | Daftar nakes & peran klinisnya |

**POST /v1/admin/nakes-accounts — Request:**
```json
{
  "fullName": "dr. Dewi Lestari",
  "phone": "081100000001",
  "password": "minimal-8-karakter",
  "nakesRole": "DOKTER",
  "puskesmasId": "6f1a1e7c-3f1c-4a2b-9c1d-2b7a5e0d1a01"
}
```
`nakesRole`: `DOKTER` | `PERAWAT` | `BIDAN` | `KADER` | `LAINNYA`. Kolom ini **wajib diisi eksplisit** — tidak ada nilai default di database, supaya peran klinis selalu merupakan keputusan sadar, bukan hasil samping pembuatan akun.

Harus menyertakan `puskesmasId` atau `districtCode`: tanpa penugasan wilayah, akun nakes tidak punya scope dan tidak akan melihat pasien apa pun. Akun dan seluruh penugasannya ditulis dalam satu transaksi.

Nomor HP yang sudah dipakai ditolak `409`.

#### 3.15.1 Siklus hidup akun nakes

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| POST | `/v1/admin/nakes-accounts` | ADMIN | Undang staf (lihat di bawah) |
| GET | `/v1/admin/nakes-accounts` | ADMIN | Daftar staf + peran + status + penugasan |
| GET | `/v1/admin/nakes-accounts/:id` | ADMIN | Detail satu staf |
| PATCH | `/v1/admin/nakes-accounts/:id` | ADMIN | Ubah `nakesRole` / `staffStatus` |
| POST | `/v1/admin/nakes-accounts/:id/activation-code` | ADMIN | Terbitkan kode aktivasi baru |
| POST | `/v1/admin/nakes-accounts/:id/assignments` | ADMIN | Tambah penugasan wilayah |
| DELETE | `/v1/admin/nakes-accounts/:id/assignments/:assignmentId` | ADMIN | Tutup penugasan (tidak menghapus) |
| POST | `/v1/auth/activate` | terbuka | Staf menukar kode aktivasi dengan kata sandi |

```text
INVITED --(kode aktivasi)--> ACTIVE --> SUSPENDED --> ACTIVE
   |                          |
   +--------------------------+------> DEACTIVATED  (final, tidak bisa dihidupkan lagi)
```

`staffStatus` adalah sumber kebenaran kelayakan login; `users.isActive` selalu
disinkronkan dari kolom itu. Menuju status selain `ACTIVE` juga **menutup seluruh
penugasan aktif** staf tersebut (`is_active = false` + `ended_at`), karena penugasan
yang tertinggal berarti staf masih punya wilayah walau sudah ditangguhkan. Baris
penugasan tidak dihapus supaya riwayat bisa diaudit.

**POST /v1/admin/nakes-accounts — Request:**
```json
{
  "fullName": "Perawat Baru",
  "phone": "081200000002",
  "nakesRole": "PERAWAT",
  "assignments": [{ "` + LOW + `Id": "6f1a1e7c-3f1c-4a2b-9c1d-2b7a5e0d1a01" }]
}
```

`assignments` wajib berisi minimal satu entri. Ada dua jalur pembuatan akun:

- `password` **dikosongkan** -> akun berstatus `INVITED` dan respons mengembalikan
  `activationCode` (6 digit). Kode ini hanya ditampilkan sekali: yang disimpan di
  database adalah hash-nya. Hilang? `POST /:id/activation-code` menerbitkan yang baru
  dan membatalkan yang lama.
- `password` **diisi** -> akun langsung `ACTIVE`, tanpa kode.

`assignments` menolak puskesmas yang tidak ada maupun yang sedang nonaktif (`400`/`404`).

**POST /v1/auth/activate — Request:**
```json
{ "phone": "081200000002", "code": "418372", "password": "SandiBaru123" }
```

Kode salah, kedaluwarsa (`ACTIVATION_CODE_TTL_SEC`, default 7 hari), atau sudah pernah
dipakai ditolak dengan pesan yang sama — `400 "Kode aktivasi salah atau sudah kedaluwarsa"`
— supaya pesan error tidak bisa dipakai untuk menebak kode yang benar. Setelah berhasil,
hash kode dihapus (sekali pakai), akun menjadi `ACTIVE` dan nomor HP terverifikasi.

Endpoint ini terbuka tanpa token karena memang belum ada akun aktif untuk orang tersebut;
kode itulah bukti kepemilikan akun, dan kode hanya bisa dibuat admin.

---

### 3.17 Autentikasi Endpoint

### 3.17.1 Endpoint yang wajib bertoken

Seluruh `/v1/*` memerlukan `Authorization: Bearer <token>` kecuali yang ditulis
eksplisit di bawah. Termasuk yang semula terbuka dan kini ditutup:

| Endpoint | Role | Isi sensitif yang dilindungi |
|---|---|---|
| `GET /v1/emergencies/*` | care team | Lokasi GNSS, detak jantung, nomor HP |
| `GET /v1/escalations/*` | care team | NIK, `livingSituation`, nomor HP keluarga |
| `POST /v1/vitals` | care team | Menulis vital yang memicu alert darurat |
| `POST /internal/jobs/*` | nakes, admin | Memicu transisi eskalasi |
| `/v1/dev/whatsapp/*` | care team (tanpa FARMASI) | Membaca & memicu percakapan WhatsApp mock |

Pengecualian yang tetap terbuka: `POST /v1/auth/*` (login/OTP/aktivasi staf) dan
`POST /v1/webhooks/whatsapp` (verifikasi signature provider).

`POST /v1/emergencies/:id/respond` dan `/timeout` tetap dibuka untuk
`PATIENT`/`FAMILY` — itulah cara pasien menjawab "Apakah Anda aman?", dan
menutupnya akan mematikan jaring pengaman yang justru menjadi inti fitur.

---

## 3.18 Peran Klinis Nakes

| Peran | Draft resep | **Setujui resep** | **Setujui permintaan obat** | Ambang HR | Lihat dashboard & data pasien |
|---|---|---|---|---|---|
| `DOKTER` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `BIDAN` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PERAWAT` | ✅ | ❌ `403` | ❌ `403` | ❌ `403` | ✅ |
| `KADER` | ✅ | ❌ `403` | ❌ `403` | ❌ `403` | ✅ |
| `FARMASI` | ❌ `403` | ❌ `403` | ❌ `403` | ❌ `403` | ❌ `403` |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ (seluruh wilayah) |

### 3.18.1 `FARMASI`

Apotek punya satu responsibility: menyiapkan dan menyerahkan obat. Aksesnya
**hanya** ke `/v1/medication-requests*` dan `/v1/dispensing-records`.

Semua data pasien lain tertutup untuknya lewat `requireCareTeamRole`: dashboard,
daftar & detail pasien (NIK, alamat, riwayat penyakit, skor risiko, ambang HR),
resep, kepatuhan, vital, darurat, dan eskalasi. Alasannya prinsip data
minimization — apotek butuh nama, obat, dosis, jumlah, dan nomor kontak untuk
menyerahkan obat; sisanya tidak diperlukan dan tidak bisa dia bertindak upon.

Verifikasi identitas saat penyerahan dilakukan dengan melihat KTP pasien,
bukan dengan membaca NIK dari sistem.

> Gate sesungguhnya ada di **server** (`requireCareTeamRole` /
> `requirePharmacyRole` di `lib/auth.ts`). Menyembunyikan menu di UI bukan
> pengaman — endpoint tetap menolak `403` bila diakses langsung.

> `FARMASI` adalah satu-satunya peran yang boleh mengubah status penyiapan &
> penyerahan obat (`PATCH /v1/medication-requests/:id/status`) — dan satu-satunya
> yang **tidak** bisa.-Prescribe, menyetujui permintaan, dan menetapkan ambang HR
> tetap milik `DOKTER`/`BIDAN`. Kennethuan berlawanan ini disengaja: satu peran
> tidak boleh melakukan dua hal yang bertentangan.
| `ADMIN` | ✅ | ✅ | ✅ | ✅ (seluruh wilayah) |

Peran klinis (`nakesRole`) dibaca dari klaim JWT dan berlaku selama masa berlaku token, jadi perubahan peran baru berlaku setelah nakes login ulang.

> Jalur pendaftaran lewat kader/posyandu untuk pasien tinggal sendiri **belum ada**; pasien didaftarkan oleh nakes (Tahap 1). Lihat rencana lanjutan.

---

## 4. WebSocket (Socket.IO)

### 4.1 Auth
Handshake dengan `auth: { token: JWT }`. Server memvalidasi & membuka room sesuai scope.

### 4.2 Rooms (scope nakes)
- `nakes:{nakesUserId}` — semua alert untuk nakes tsb.
- `puskesmas:{puskesmasId}` — alert scope puskesmas.
- `district:{districtCode}` — alert scope wilayah.

### 4.3 Events

| Event (server → client) | Payload | Penerima |
|---|---|---|
| `emergency.priority` | `{ emergency, patientSummary, location, escalationRunId }` | nakes rooms |
| `compliance.updated` | `{ patientId, scheduleId, status }` | pasien app / keluarga |
| `escalation.step` | `{ runId, tier, status, contactSummary }` | nakes |
| `risk.updated` | `{ patientId, riskLevel, score }` | nakes scope |

| Event (client → server) | Payload | Pengirim |
|---|---|---|
| `subscribe.scope` | `{ scope: "puskesmas", id: "ps1" }` | nakes |
| `emergency.ack` | `{ emergencyId }` | nakes (tandai sudah dilihat) |

### 4.4 Skema Event `emergency.priority`
```json
{
  "event": "emergency.priority",
  "data": {
    "emergencyId": "e1",
    "triggeredAt": "2026-08-16T02:01:00Z",
    "triggerType": "ANOMALY_HR",
    "hrBpm": 145,
    "patient": { "id": "p1", "fullName": "Bu Ratna", "livingSituation": "ALONE" },
    "location": { "lat": -7.79, "lng": 110.37, "accuracyM": 12 },
    "escalationRunId": "r1",
    "tier": "NAKES",
    "actionUrl": "/dashboard/alerts/e1"
  }
}
```

---

## 5. Scheduler / Webhook (Server-to-Server)

Tidak ada lagi endpoint HTTP untuk memicu reminder atau timeout eskalasi. Keduanya
sekarang berjalan sebagai job queue persisten yang didaftarkan saat server start
(`src/index.ts` → `buildApp({ enableReminderScheduler, enableEscalationScheduler })`).
Endpoint di bawah tetap dipertahankan hanya sebagai pemicu manual/operasional.

### Dispatcher reminder (`reminder-dispatcher`)

Satu tick tiap 60 detik memindai `schedules` dan menjadwalkan job `reminder` untuk slot
yang jatuh di dalam horizon 10 menit ke depan, memakai `nextFireAt` (§3.3). Job
dijadwalkan dengan `jobId` deterministik `reminder:{scheduleId}:{dueAt}`, jadi pemindaian
berulang pada slot yang sama tidak menghasilkan kiriman ganda.

Pemindaian hanya mengambil jadwal yang:

```text
is_active = true
  AND schedules.status = 'APPROVED'          // gate klinis (§3.2)
  AND patients.status = 'ACTIVE'             // gate operasional (§3.1)
```

`handleReminderJob` memeriksa ulang ketiga syarat tersebut, jadi jalur internal/manual
yang memancing job secara langsung tetap tidak bisa mengirim ke pasien non-ACTIVE.

### Reconciler timeout eskalasi (`escalation-timeout-reconcile`)

Satu tick tiap 60 detik memindai `escalation_runs` yang berstatus `WAITING_PATIENT`,
`FAMILY_TIER_1`, `FAMILY_TIER_2`, atau `NAKES`, lalu menjadwalkan job
`escalation-timeout` pada waktu habisnya tier berjalan. `jobId`-nya
`escalation-timeout:{runId}:{status}`, jadi tick berulang tidak menumpuk job.

Reconciler dipilih daripada chaining karena satu tick idempoten memastikan setiap run
aktif selalu punya timeout terjadwal — termasuk run yang timeout-nya hilang akibat
restart. Job basi tetap aman: `handleEscalationTimeout` membandingkan
`expectedStatus` dan melewati run yang sudah berganti tier atau sudah selesai.

Alert keluarga dan nakes dikirim lewat `WhatsAppEscalationNotifier` yang memakai
`WhatsAppService` (provider aktif dari `PROVIDER_MODE`), bukan mock.

### POST `/internal/jobs/escalation-timeout` (internal service)
Pemicu manual untuk operational debugging. Body: `{ runId, currentState }`. Response: `{ newState }` atau `422` jika state sudah berubah (idempoten). Jalur ini memakai notifier produksi, sehingga alert benar-benar terkirim.

### POST `/internal/vitals/webhook` (smartwatch provider webhook, opsional)
Menampung push dari Google Fit/HealthKit → sama seperti `POST /v1/vitals`. Auth via service token.

---

## 6. Webhook WhatsApp

### POST `/webhooks/whatsapp`
Public endpoint yang dipanggil Meta/Twilio. Verifikasi signature:
- Header `X-Hub-Signature-256` (Meta) — HMAC-SHA256 dari raw body dengan `WA_APP_SECRET`.
- Webhook config: `hub.verify_token` pada setup.

**Payload contoh (Meta interactive button reply):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WAID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "14155238886", "phone_number_id": "PHONE_ID" },
            "contacts": [{ "profile": { "name": "Bu Ratna" }, "wa_id": "62812xxxxxxx" }],
            "messages": [
              {
                "from": "62812xxxxxxx",
                "id": "wamid.ABC123",
                "timestamp": "1723800000",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": { "id": "CONFIRM_TAKEN_s1", "title": "Sudah Minum" }
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Aturan handler:**
1. Verifikasi signature (HMAC) — jika gagal `401`.
2. Cek duplikat `message.id` (dedup lewat unik `notifications.providerMessageId`) → `200 OK` tanpa proses.
3. Parsing `button_reply.id` → intent + resource id (format di [§6.1](#61-format-button_replyid)).
4. Teruskan ke `dispatchWaIntent` (`modules/wa-intents`) — satu-satunya tempat intent
   dipetakan ke domain service.
5. Selalu balas `200 OK`. Kegagalan domain (409/403/422) dikembalikan di `data.dispatchError`,
   bukan dilempar jadi 5xx: payload yang sama pasti ditolak lagi, dan 5xx hanya membuat
   Meta mengirim ulang tanpa gunanya.
6. Message masuk non-interactive (teks biasa) → route ke chatbot edukasi (§3.11) atau fallback.

**Response 200:**
```json
{
  "data": {
    "processed": true,
    "intent": "CONFIRM_TAKEN",
    "resourceId": "9c2e4d5a-…",
    "dispatch": {
      "outcome": "CONFIRMED",
      "resourceType": "schedule",
      "resourceId": "9c2e4d5a-…",
      "details": { "logId": "…", "escalationRunId": "…", "escalationResolved": true }
    },
    "dispatchError": null
  }
}
```

**Ownership.** Dispatcher menolak reply yang pengirimnya bukan pemilik resource (`403`).
Untuk `CONFIRM_TAKEN`/`DEFER`/`SAFE`/`NEED_HELP` nomornya harus sama dengan nomor pasien pada
jadwal/darurat tersebut; untuk `HANDLE` pengirim harus user, kontak keluarga, atau kontak nakes
pasien yang punya run tersebut. Nomor yang tidak dikenal tidak pernah bisa menutup alarm.

### 6.1 Format `button_reply.id`

Tombol reply memakai format `<INTENT>_<resourceId>` (contoh `CONFIRM_TAKEN_9c2e…`).
Parser di `apps/api/src/integrations/whatsapp/parser.ts` (`parseButtonReply`) mengurai intent + resource id.
Id tak dikenal (termasuk tombol URL `CALL_112` / `MAPS`) dikembalikan `null`.

| Intent | Button id (contoh) | Digunakan di | resource id |
|---|---|---|---|
| `CONFIRM_TAKEN` | `CONFIRM_TAKEN_<scheduleId>` | Reminder: pasien "Sudah Minum" (FR-2) | id jadwal |
| `DEFER` | `DEFER_<scheduleId>` | Reminder: "Tunda 15 menit" (FR-2.4) | id jadwal |
| `SAFE` | `SAFE_<emergencyId>` | Konfirmasi darurat: "Saya aman" (FR-4.4) | id darurat |
| `NEED_HELP` | `NEED_HELP_<emergencyId>` | Konfirmasi darurat: butuh bantuan → langsung eskalasi | id darurat |
| `HANDLE` | `HANDLE_<escalationRunId>` | Keluarga/nakes: "Saya tangani" (FR-7.3) | id run eskalasi |

Tombol URL (bukan reply, tidak di-parse sebagai intent):

| id | Tujuan | Keterangan |
|---|---|---|
| `CALL_112` | `tel:112` | Deep-link satu ketukan ke 112 — **one-tap call, bukan auto-dial** (ADR-008). |
| `MAPS` | `https://maps.google.com/?q=lat,lng` | Peta lokasi pasien saat darurat. |

Template & komposisi pesan ada di `apps/api/src/integrations/whatsapp/templates.ts`. Pesan menghadap
pengguna dalam Bahasa Indonesia dan hanya memuat PII minimal (nama pasien/obat boleh; NIK/tanggal lahir tidak pernah).

---

## 6.2 WhatsApp Simulator (demo presentasi)

Endpoint `/v1/dev/whatsapp/*` menjalankan simulasi WhatsApp **tanpa Meta Cloud API dan tanpa
nomor riil**. Hanya berlaku pada dua mode: `PROVIDER_MODE=mock` + `SIMULATOR_ENABLED=true`.

Guard berlapis (semuanya wajib):
1. `SIMULATOR_ENABLED` — `env.ts` menolak startup production yang menyalakannya, dan route
   membalas `404` (bukan `403`) saat env dimatikan, supaya route tidak bisa dipetakan.
2. `authenticate` — tidak ada endpoint dev yang terbuka.
3. `requireCareTeamRole` — **apotek (`FARMASI`) dikecualikan**: panel menampilkan nomor HP dan
   isi pesan pasien, sedangkan apotek hanya berhak menyentuh antrean obat (§3.18.1).

| Method | Path | Deskripsi |
|---|---|---|
| GET | `/v1/dev/whatsapp/status` | Status simulator, provider mode, scenario tersedia |
| GET | `/v1/dev/whatsapp/threads` | Daftar percakapan per penerima + label sintetis |
| GET | `/v1/dev/whatsapp/messages?to=<waId>` | Isi percakapan (`meta.recipient` = label penerima) |
| POST | `/v1/dev/whatsapp/messages/:messageId/reply` | Tekan tombol: `{ "buttonId": "CONFIRM_TAKEN_<scheduleId>" }` |
| POST | `/v1/dev/whatsapp/scenarios/:scenario/trigger` | Jalankan scenario demo |
| POST | `/v1/dev/whatsapp/scenarios/reset` | Reset fixture demo (hanya namespace demo) |
| POST | `/v1/dev/whatsapp/provider-failure` | Sakelar kegagalan mock: `{ "enabled": true }` |

**Scenario:** `REMINDER_CONFIRMED`, `REMINDER_NO_RESPONSE`, `HEART_RATE_ANOMALY`, `PROVIDER_FAILURE`.

Balasan tombol tidak pernah mengubah tabel domain secara langsung. `messageId` +
`buttonId` diteruskan ke `dispatchWaIntent` yang sama dengan webhook produksi, jadi
idempotensi dan cek ownership berlaku sama. Tombol yang sudah dibalas, tombol milik pesan
lain, atau tombol yang bukan `REPLY` semuanya ditolak `404`.

Reset menghapus percakapan mock dan baris milik **dua persona demo saja**
(`DEMO_IDS.userBuRatna`, `DEMO_IDS.userPakHaji`) di `compliance_logs`, `reminder_logs`,
`escalation_runs`/`escalation_steps`, `emergency_alerts`, dan `notifications` mock. Akun,
resep, jadwal, dan data non-demo tidak disentuh.

---

## 7. Autentikasi Antar-Layanan (Service Tokens)

- Token statis `SERVICE_TOKEN` dibagikan antar internal endpoint (`/internal/*`, `/v1/vitals` dari adapter).
- Dipakai untuk mencegah akses publik; tidak membawa identitas user.

---

## 8. Rate Limiting

| Endpoint/Grup | Limit | Catatan |
|---|---|---|
| Auth (OTP request/verify) | 5/menit per phone | Anti-brute force |
| API umum | 120 req/min per token | |
| Webhook WhatsApp | 300 req/min per IP | Idempotency wajib |
| WebSocket handshake | 30/min per IP | |
| Export download | 20/min per user | |

> Konfigurasi & strategi detail: [SECURITY.md](SECURITY.md#rate-limiting)

---

## 9. Versioning & Changelog

- URL prefix `/v1`. Perubahan breaking → `/v2` + deprecation notice 1 versi.
- Setiap perubahan kontrak API wajib update dokumen ini + zod schema shared (`packages/shared/validation`).
- Changelog ringkas ditulis di commit message (conventional commits).
