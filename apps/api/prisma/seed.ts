// Seed data sintetis untuk demo (data fiktif — UU PDP: tanpa data pasien riil).
// Jalankan: npm run db:seed -w @careloop/api
import { PrismaClient } from '@prisma/client'
import { seedDemoPersonas } from './personas'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  console.log('Seeding data sintetis CareLoop...')
  await seedDemoPersonas(prisma)
  console.log('Seed selesai. Data demo: Bu Ratna (ALONE) & Pak Haji (WITH_FAMILY).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
