# Fase 4 — Hardening, Keamanan & Demo (Minggu 4)

> Target: sistem stabil & aman untuk demo, data demo rapi, script demo mulus, pitch deck siap.
> Referensi: [SECURITY.md](../docs/SECURITY.md), [TESTING.md](../docs/TESTING.md), [PRD §11 Risiko](../docs/PRD.md).

## 4.1 Hardening Teknis

- [ ] **Queue recovery**: restart server tidak menggagalkan eskalasi/reminder yang tertunda (job persisten BullMQ + DB-backed state) — simulasi restart saat run aktif.
- [ ] Timeout & konfigurasi semua di env/config, bukan hardcode (AGENTS.md §2.1).
- [ ] Idempotency di semua webhook & event (WA, smartwatch) — uji kirim ganda.
- [ ] Latency API < 500ms p95 untuk aksi non-batch (PRD §8).
- [ ] Jangan ada `setTimeout` untuk logika bisnis; semua lewat scheduler.

## 4.2 Keamanan (SECURITY.md)

- [ ] CORS: ganti `origin: true` dengan whitelist domain web (lihat TODO di `apps/api/src/app.ts`).
- [ ] Rate limiting sudah terpasang — verifikasi nilai wajar untuk endpoint publik vs autentikasi.
- [ ] RBAC lengkap: pasien, keluarga, nakes, admin — akses data sesuai scope.
- [ ] Audit log pada aksi sensitif (export, perubahan data pasien, eskalasi).
- [ ] Scan secret: pastikan tidak ada `.env`/key masuk repo; `git grep` token.
- [ ] `npm audit` — tinjau & minimalisasi vulnerability yang mungkin (jangan `--force`).
- [ ] Verifikasi UU PDP: data sintetis di semua env, minimisasi data, consent flow.

## 4.3 Testing Kritis

- [ ] Review coverage alur kritis (lihat [TESTING.md](../docs/TESTING.md)): reminder, konfirmasi, eskalasi bertingkat, darurat, idempotency.
- [ ] Test e2e minimal: `reminder → konfirmasi`, `mock anomaly → alert keluarga+nakes`, `dashboard render`.
- [ ] Regression penuh: `npm run typecheck && npm run lint && npm run test`.

## 4.4 Data & Persiapan Demo

- [ ] Seed final: 2–3 pasien persona (Bu Ratna, Pak Haji + 1 lagi), keluarga multi-tier, faskes, jadwal realistis.
- [ ] Data demo **sintetis/anonim** — audit semua nama/NIK/HP (AGENTS.md §2).
- [ ] Persiapkan sandbox WhatsApp aktif (template + interactive button disetujui).
- [ ] Checklist demo journey (dari PRD §9): 7/7 user story P0 end-to-end.
- [ ] Rehearsal demo ≥ 2×, catat skrip narasi per langkah.

## 4.5 Pitch & Dokumentasi

- [ ] Slide/deck: problem → solusi → demo → dampak SDG 3 → roadmap.
- [ ] README diperbarui (cara run, struktur, link demo).
- [ ] Screenshot dashboard & app untuk materi presentasi.
- [ ] Catat keputusan arsitektur & asumsi di docs (jika belum).
- [ ] Backup env/artefak demo (bukan secret) untuk kelanjutan proyek.

## 4.6 Definition of Done Akhir

- [ ] Seluruh item fase 1–3 berstatus selesai (atau dinyatakan WON'T dengan alasan).
- [ ] `typecheck`, `lint`, `test` hijau dari root.
- [ ] Tidak ada secret di repo; CORS/security terkonfigurasi.
- [ ] Demo journey P0 mulus & sudah dilatih.
