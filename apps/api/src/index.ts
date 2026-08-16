import { buildApp } from './app'
import { env } from './lib/env'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

void main()
