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
    "user": { "id": "u1", "role": "NAKES", "fullName": "dr. Dewi Lestari", "isVerified": true }
  }
}
```

- `expiresIn` dalam detik, berasal dari `JWT_EXPIRES_IN` (default `24h`).
- Claim token: `{ sub, role }` — tanpa data pribadi.
- **401 `UNAUTHORIZED`** dengan pesan tunggal `Nomor/email atau kata sandi salah` untuk semua
  kegagalan kredensial (akun tidak ada, kata sandi salah, role bukan nakes/admin, akun tanpa
  kata sandi). Pesan sengaja tidak dibedakan agar nomor terdaftar tidak bisa ditebak.
- **403 `FORBIDDEN`** hanya jika kata sandi benar tetapi akun dinonaktifkan.
- Akun demo seed: `081100000001` / `CareLoop#Demo2026` (dr. Dewi Lestari — data sintetis).

### POST `/v1/auth/refresh`
Refresh JWT dengan `refreshToken` di body.

---

## 3. Endpoint per Domain

> Hanya endpoint MVP yang didokumentasikan. Header `Authorization` wajib kecuali dinyatakan "public". RBAC per role dijelaskan di setiap endpoint.

### 3.1 Pasien

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me` | PATIENT, FAMILY (scope) | Profil lengkap pasien (detail jika `can_view_health`) |
| PUT | `/v1/patients/me` | PATIENT | Update profil (alamat, living_situation, timezone, voice_enabled, dll.) |
| GET | `/v1/patients/:id` | NAKES (scope), PATIENT (diri sendiri) | Detail pasien |
| GET | `/v1/patients` | NAKES, ADMIN | Daftar pasien (filter: `district`, `disease`, `riskLevel`, `status`) |

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

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/medications` | PATIENT | Daftar obat |
| POST | `/v1/patients/me/medications` | PATIENT, NAKES (scope) | Tambah obat |
| PUT | `/v1/medications/:id` | NAKES | Update obat |
| GET | `/v1/patients/me/schedules` | PATIENT | Daftar jadwal |
| POST | `/v1/patients/:id/schedules` | NAKES | Buat jadwal |
| PUT | `/v1/schedules/:id` | NAKES, PATIENT | Update jadwal (reschedule) |
| PUT | `/v1/schedules/:id/toggle` | PATIENT, NAKES | Aktif/nonaktif |

**POST /v1/patients/:id/schedules — Request:**
```json
{
  "medicationId": "6f1a1e7c-3f1c-4a2b-9c1d-2b7a5e0d1a01",
  "timeOfDay": "08:00",
  "daysOfWeek": [1,2,3,4,5,6,7],
  "dailyFrequency": 1,
  "doseQty": "1 tablet",
  "startDate": "2026-08-01",
  "timeWindowMinutes": 30,
  "isActive": true
}
```
**Response 201:** objek `schedule` + `nextFireAt` (dihitung server).
- `daysOfWeek` kosong / tidak dikirim = setiap hari. `dailyFrequency` default `1`.


### 3.3 Reminder & Konfirmasi (Fitur 1–3)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/reminders` | PATIENT | Riwayat reminder (status, waktu) |
| POST | `/v1/compliance/confirm` | PATIENT | Konfirmasi "sudah minum" (app) |
| POST | `/v1/compliance/defer` | PATIENT | "Tunda 15 menit" |
| GET | `/v1/patients/me/compliance` | PATIENT, FAMILY(scope) | Riwayat kepatuhan |

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
    "status": "CONFIRMED",
    "confirmedAt": "2026-08-16T01:12:00Z",
    "escalationCancelled": true
  }
}
```
- `channel` menerima subset `Channel`: `IN_APP` (default), `WHATSAPP`, `VOICE`.
- Idempoten: konfirmasi ganda → `409 ALREADY_PROCESSED` (atau mengembalikan log yang sama dengan `200`).
- **Konfirmasi via WhatsApp** masuk lewat webhook (lihat §6) — bukan endpoint ini.

### 3.4 Vital & Anomali (Fitur 4)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| POST | `/v1/vitals` | SMARTWATCH_SERVICE (service token) | Ingest event vital (dari smartwatch adapter) |
| GET | `/v1/patients/me/vitals` | PATIENT, NAKES (scope) | Riwayat vital |
| POST | `/v1/dev/mock-anomaly` | (dev only) | Trigger anomali sintetis untuk demo |

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
| GET | `/v1/patients/me/family-contacts` | PATIENT | Daftar kontak keluarga |
| POST | `/v1/patients/me/family-contacts` | PATIENT, NAKES(scope) | Tambah kontak |
| PUT | `/v1/family-contacts/:id` | PATIENT | Update tier/prioritas/aktif |
| DELETE | `/v1/family-contacts/:id` | PATIENT | Hapus kontak |
| GET | `/v1/patients/:id/nakes-contacts` | NAKES, PATIENT | Daftar nakes pasien |
| POST | `/v1/patients/:id/nakes-contacts` | NAKES(scope) | Assign nakes/kader |

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

### 3.9 Refill (Fitur 6)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/refill-status` | PATIENT, FAMILY(scope) | Estimasi stok & tanggal habis |
| POST | `/v1/refill/:medicationId/confirm` | PATIENT, FAMILY(scope) | Tandai "sudah ambil obat" |
| GET | `/v1/patients/:id/refill-status` | NAKES (scope) | Per pasien |

### 3.10 Edukasi & Skrining (Fitur 8, 9)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/education/topics` | PATIENT | Daftar topik edukasi |
| GET | `/v1/education/topics/:key` | PATIENT | Konten topik |
| POST | `/v1/screenings` | PATIENT | Mulai skrining |
| POST | `/v1/screenings/:id/answers` | PATIENT | Jawab kuesioner |
| POST | `/v1/screenings/:id/submit` | PATIENT | Submit → skor + level |
| GET | `/v1/screenings` | PATIENT, NAKES(scope) | Riwayat skrining |

### 3.11 Faskes Terdekat (Fitur 10)

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

### 3.12 Risk Prediction (Fitur 12)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/patients/me/risk` | PATIENT | Skor + faktor |
| GET | `/v1/patients/:id/risk` | NAKES(scope) | Per pasien |
| POST | `/v1/risk/recompute` | ADMIN (job) | Trigger recompute (biasanya job harian) |

### 3.13 Export Anonim (Fitur 13)

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

### 3.14 Audit (Admin)

| Method | Path | Role | Deskripsi |
|---|---|---|---|
| GET | `/v1/audit-logs` | ADMIN | Query audit log (filter action, actor, date) |

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

### POST `/internal/jobs/reminder` (internal service)
Dipanggil worker scheduler untuk membangun & mengirim reminder. Body: `{ scheduleId, dueAt }`. Response: `{ reminderLogId }`.

### POST `/internal/jobs/escalation-timeout` (internal service)
Dipanggil BullMQ saat timeout state machine. Body: `{ runId, currentState }`. Response: `{ newState }` atau `422` jika state sudah berubah (idempoten).

### POST `/internal/vitals/webhook` (smartwatch provider webhook, opsional)
Menampung push dari Google Fit/HealthKit → sama seperti `POST /v1/vitals`. Auth via service token.

---

## 6. Webhook WhatsApp

### POST `/webhooks/whatsapp`
Public endpoint yang dipanggil Meta/Twilio. Verifikasi signature:
- Header `X-Hub-Signature-256` (Meta) — HMAC-SHA256 dari raw body dengan `WA_WEBHOOK_APP_SECRET`.
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
2. Cek duplikat `message.id` (sudah di `compliance_logs.source_message_id`) → `200 OK` tanpa proses.
3. Parsing `button_reply.id` → intent + resource id (format di [§6.1](#61-format-button_replyid)).
4. Eksekusi service terkait (compliance confirm / emergency response / escalation respond).
5. Selalu balas `200 OK` (Meta butuh cepat; pemrosesan async + status 200).
6. Message masuk non-interactive (teks biasa) → route ke chatbot edukasi (§3.10) atau fallback.

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
