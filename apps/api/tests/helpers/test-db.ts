// Helper database untuk integration test.
// Test HARUS memakai DB terpisah lewat TEST_DATABASE_URL — helper ini menolak
// berjalan di DATABASE_URL (DB dev/Supabase) karena melakukan TRUNCATE.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

// vitest dijalankan dari apps/api (lokasi vitest.config.ts).
const API_ROOT = process.cwd()

export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL?.trim()
  return url && url.length > 0 ? url : undefined
}

export function isTestDbConfigured(): boolean {
  return testDatabaseUrl() !== undefined
}

function requireSafeTestUrl(): string {
  const url = testDatabaseUrl()
  if (!url) {
    throw new Error('TEST_DATABASE_URL belum diset — integration test seharusnya dilewati.')
  }
  if (url === process.env.DATABASE_URL?.trim()) {
    throw new Error(
      'TEST_DATABASE_URL sama dengan DATABASE_URL. Integration test melakukan TRUNCATE — ' +
        'arahkan ke database test terpisah (lihat infra/docker-compose.yml).',
    )
  }
  return url
}

function prismaCliPath(): string {
  const candidates = [
    path.join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(API_ROOT, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error('CLI prisma tidak ditemukan — jalankan npm install dulu.')
  return found
}

/** Menyiapkan skema di DB test: prisma migrate deploy pada TEST_DATABASE_URL. */
export function migrateTestDb(): void {
  const url = requireSafeTestUrl()
  execFileSync(process.execPath, [prismaCliPath(), 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
    timeout: 120_000,
  })
}

export function createTestPrisma(): PrismaClient {
  const url = requireSafeTestUrl()
  return new PrismaClient({ datasources: { db: { url } } })
}

/** Mengosongkan seluruh tabel domain (riwayat migrasi Prisma dipertahankan). */
export async function resetTestDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `
  if (rows.length === 0) return

  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export async function teardownTestDb(prisma: PrismaClient): Promise<void> {
  await prisma.$disconnect()
}
