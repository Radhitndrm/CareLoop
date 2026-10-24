#!/usr/bin/env bash
# Menjalankan seluruh smoke test HTTP terhadap API yang sedang berjalan.
#
# PENTING: API harus diarahkan ke database terpisah dari TEST_DATABASE_URL.
# `npm run test` melakukan TRUNCATE ke careloop_test, jadi memakai DB yang sama
# akan menghapus data di tengah pengujian.
set -u
cd "$(dirname "$0")/.."

# Reset DB dulu: smoke test tidak idempoten, dan data run sebelumnya akan bentrok
# (nomor HP ganda, cooldown OTP, dst).
if [ "${SKIP_RESET:-0}" != "1" ]; then
  ./scripts/reset-smoke-db.sh || { echo "reset DB gagal"; exit 1; }
fi

echo "API: ${BASE:-http://localhost:4000}"
total_fail=0
for s in crud safety mobile; do
  echo
  echo "### $s ###"
  if [ "$s" = "mobile" ]; then
    npx tsx "scripts/smoke-$s.js" || total_fail=$((total_fail+1))
  else
    node "scripts/smoke-$s.js" || total_fail=$((total_fail+1))
  fi
done
echo
echo "=============================="
echo "smoke test selesai, script gagal: $total_fail"
exit "$total_fail"
