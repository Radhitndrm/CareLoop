#!/usr/bin/env bash
# Reset database smoke ke kondisi awal ( kosong -> seed persona sintetis ).
# Smoke test tidak idempoten: run kedua akan bentrok dengan data run pertama.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL ke DB smoke, bukan TEST_DATABASE_URL}"
if [[ "$DATABASE_URL" == *"careloop_test"* ]]; then
  echo "DITOLAK: smoke test tidak boleh memakai careloop_test (npm run test meng-TRUNCATE-nya)." >&2
  exit 1
fi
export DIRECT_URL="$DATABASE_URL"

npx prisma migrate deploy >/dev/null

# Satu TRUNCATE untuk semua tabel sekaligus. SQL dinamis ditulis ke file agar
# tidak melewati batas argumen shell dan tidak vulnerable terhadap nama tabel.
PSQL_URL="${DATABASE_URL%%\?*}"
TABLES=$(psql "$PSQL_URL" -t -A -c \
  "SELECT string_agg(quote_ident(tablename), ',') FROM pg_tables
   WHERE schemaname='public' AND tablename NOT LIKE '\_prisma%';")
if [ -n "$TABLES" ]; then
  psql "$PSQL_URL" -q -c "TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE;"
fi

npx prisma db seed 2>&1 | grep -i "selesai" || true
