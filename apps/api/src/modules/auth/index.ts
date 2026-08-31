import type { FastifyInstance } from 'fastify'
import { nakesLoginSchema } from '@careloop/shared'
import type { AuthUserClaims } from '@careloop/shared'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { expiresInSeconds, loginWithPassword, type LoginDeps } from './auth.service'

export function registerAuthRoutes(app: FastifyInstance): void {
  // Dihitung sekali saat registrasi: JWT_EXPIRES_IN yang salah format menggagalkan
  // startup, bukan menggagalkan setiap permintaan login.
  const expiresIn = expiresInSeconds(getEnv().JWT_EXPIRES_IN)

  const deps: LoginDeps = {
    findUser: ({ phone, email }) =>
      prisma.user.findFirst({
        where: phone ? { phone } : { email },
        select: {
          id: true,
          fullName: true,
          role: true,
          passwordHash: true,
          isActive: true,
          isVerified: true,
        },
      }),
    signToken: (claims: AuthUserClaims, expiresInSec: number) =>
      app.jwt.sign(claims, { expiresIn: expiresInSec }),
  }

  app.get('/v1/auth/status', async () => {
    return { data: { status: 'ok', service: 'careloop-api' } }
  })

  // POST /v1/auth/login — nakes & admin (docs/API.md §2). Pasien lewat OTP (CL-007).
  app.post('/v1/auth/login', async (req) => {
    const input = nakesLoginSchema.parse(req.body)
    return { data: await loginWithPassword(deps, input, expiresIn) }
  })
}
