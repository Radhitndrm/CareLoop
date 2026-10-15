import { buildApp } from './app'
import { EnvValidationError, getEnv } from './lib/env'
import { prisma } from './lib/prisma'

/** Batas waktu menutup server sebelum dipaksa keluar (platform mengirim SIGTERM). */
const SHUTDOWN_TIMEOUT_MS = 15_000

async function main(): Promise<void> {
  const env = getEnv()
  const app = await buildApp({
    enablePharmacyScheduler: true,
    enableReminderScheduler: true,
    enableEscalationScheduler: true,
  })

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // Platform cloud mengirim SIGTERM sebelum menutup container. Drain koneksi (WebSocket,
  // BullMQ, Redis, Prisma) supaya job yang sedang jalan tidak terpotong dan
  // replica berikutnya langsung mengambil alih.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutdown diminta, menutup server')
      const forced = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS)
      forced.unref()
      void app
        .close()
        .then(() => prisma.$disconnect())
        .then(() => process.exit(0))
        .catch(() => process.exit(1))
    })
  }
}

main().catch((err: unknown) => {
  // Env invalid dilaporkan di sini (bukan saat modul di-import) supaya pesannya jelas
  // dan modul lib/env tetap bebas efek samping untuk test.
  if (err instanceof EnvValidationError) {
    console.error(err.message)
    console.error('Periksa apps/api/.env — contoh lengkap ada di apps/api/.env.example')
  } else {
    console.error(err)
  }
  process.exit(1)
})
