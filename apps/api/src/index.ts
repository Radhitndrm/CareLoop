import { buildApp } from './app'
import { EnvValidationError, getEnv } from './lib/env'

async function main(): Promise<void> {
  const env = getEnv()
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
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
