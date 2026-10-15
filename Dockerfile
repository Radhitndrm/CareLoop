# CareLoop API — image produksi (platform-agnostic: Railway, Render, Fly, VPS).
#
# Kontrak yang dipakai semua platform:
#   build : npm ci && npx prisma generate && npm run build -w @careloop/api
#   start : node apps/api/dist/index.js
#   health: /healthz (liveness) dan /readyz (readiness, cek DB + Redis + migration)
#
# Secret TIDAK pernah ada di image — hanya di secret manager platform. Migration
# dijalankan sebagai release step (`npx prisma migrate deploy`) sebelum container
# menerima traffic, bukan dari dalam aplikasi.

# ---------------------------------------------------------------- build
FROM node:20-bookworm-slim AS build
WORKDIR /repo

# Layer dependency di-cache terpisah dari source.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts

COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# Prisma Client untuk linux (image build), bukan untuk platform host.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @careloop/api

# ---------------------------------------------------------------- runtime
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# openssl dibutuhkan engine Prisma; curl dipakai image health check.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

# Hanya production dependency. Prisma Client hasil generate ikut disalin supaya
# image tidak butuh `prisma generate` saat start. Manifest `packages/shared`
# tetap ada supaya tautan workspace npm tidak menggantung, walau kodenya sudah
# di-bundle tsup ke dalam dist.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma/client node_modules/@prisma/client
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "apps/api/dist/index.js"]