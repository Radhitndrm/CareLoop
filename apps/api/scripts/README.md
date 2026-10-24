# Smoke test manual (HTTP)

Uji API yang **sedang berjalan** lewat HTTP sungguhan — berbeda dari `npm run test`
yang memakai mock Prisma. Dipakai untuk memastikan wiring HTTP, RBAC, dan alur aman
sesuaiConsumers.

## Menjalankan

```bash
# 1. Siapkan database smoke (TERPISAH dari TEST_DATABASE_URL!)
createdb careloop_smoke
export DATABASE_URL="postgresql://careloop:careloop@127.0.0.1:5432/careloop_smoke?schema=public"

# 2. Jalankan API dengan DB smoke
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DATABASE_URL" TEST_DATABASE_URL="" \
NODE_ENV=development PROVIDER_MODE=mock SIMULATOR_ENABLED=true \
REDIS_URL="" RATE_LIMIT_MAX=100000 PORT=4000 npx tsx src/index.ts &

# 3. Jalankan smoke test (reset DB otomatis sebelum mulai)
./scripts/smoke-all.sh
```

## Kenapa DB harus terpisah

`npm run test` menjalankan integration test yang **TRUNCATE `TEST_DATABASE_URL`**.
Kalau API dev diarahkan ke database yang sama, data akan terhapus di tengah pengujian
dan hasilnya menyesatkan.

`scripts/reset-smoke-db.sh` menolak jalan bila `DATABASE_URL` mengandung `careloop_test`.

## Kenapa `RATE_LIMIT_MAX` dinaikkan

Tiga suite berisi total 68 pemeriksaan, masing-masing beberapa request. Itu melewati
batas default 120 request/menit dan memicu `429` — bukan bug, tapi membuat hasil tidak
dapat dipercaya.

## Isi suite

| Suite | Cakupan |
|---|---|
| `smoke-crud.js` | Dashboard, pasien (CRUD + lookup + duplikat), obat & gate persetujuan, jadwal, kontak keluarga, farmasi, puskesmas, admin |
| `smoke-safety.js` | Kepatuhan (confirm/defer/idempotensi), eskalasi bertingkat, darurat (SAFE/NEED_HELP/timeout), data safety per role |
| `smoke-mobile.js` | Endpoint yang dipanggil `apps/mobile` + parser deep link `careloop://` |

## Sukses

Output di akhir merangkum seperti:

```
CRUD   TOTAL 37 | lulus 37 | gagal 0
SAFETY TOTAL 19 | lulus 19 | gagal 0
MOBILE TOTAL 12 | lulus 12 | gagal 0
```
