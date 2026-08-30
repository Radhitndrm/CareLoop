// Error handler terpusat API CareLoop.
// Kontrak envelope: { error: { code, message, details? } } — docs/API.md §1.5.
// Controller tidak menangkap error sendiri; lempar ApiError (atau biarkan Zod/Prisma
// melempar) dan handler ini yang menormalisasi status + kode.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export type ApiErrorDetails = unknown

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: ApiErrorDetails
  }
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiErrorDetails,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, details?: ApiErrorDetails): ApiError =>
  new ApiError(400, ApiErrorCode.VALIDATION_ERROR, message, details)

export const unauthorized = (message = 'Token tidak valid atau kedaluwarsa'): ApiError =>
  new ApiError(401, ApiErrorCode.UNAUTHORIZED, message)

export const forbidden = (message = 'Di luar scope akses Anda'): ApiError =>
  new ApiError(403, ApiErrorCode.FORBIDDEN, message)

export const notFound = (message = 'Data tidak ditemukan', details?: ApiErrorDetails): ApiError =>
  new ApiError(404, ApiErrorCode.NOT_FOUND, message, details)

export const conflict = (message: string, details?: ApiErrorDetails): ApiError =>
  new ApiError(409, ApiErrorCode.CONFLICT, message, details)

export const alreadyProcessed = (
  message = 'Permintaan ini sudah pernah diproses',
  details?: ApiErrorDetails,
): ApiError => new ApiError(409, ApiErrorCode.ALREADY_PROCESSED, message, details)

export const invalidTransition = (message: string, details?: ApiErrorDetails): ApiError =>
  new ApiError(422, ApiErrorCode.INVALID_TRANSITION, message, details)

export interface NormalizedError {
  statusCode: number
  body: ApiErrorBody
  /** true = perlu dicatat sebagai error (bukan kesalahan klien). */
  isInternal: boolean
}

function zodDetails(error: ZodError): Array<{ field: string; reason: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    reason: issue.message,
  }))
}

function fromPrisma(error: Prisma.PrismaClientKnownRequestError): NormalizedError | undefined {
  const target = (error.meta?.target as string[] | string | undefined) ?? undefined

  switch (error.code) {
    case 'P2002':
      return normalized(
        alreadyProcessed('Data dengan nilai unik yang sama sudah ada', { target }),
      )
    case 'P2025':
      return normalized(notFound('Data tidak ditemukan'))
    case 'P2003':
      return normalized(conflict('Relasi data tidak valid', { target }))
    default:
      return undefined
  }
}

function normalized(error: ApiError): NormalizedError {
  return {
    statusCode: error.statusCode,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    isInternal: error.statusCode >= 500,
  }
}

function statusToCode(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
      return ApiErrorCode.VALIDATION_ERROR
    case 401:
      return ApiErrorCode.UNAUTHORIZED
    case 403:
      return ApiErrorCode.FORBIDDEN
    case 404:
      return ApiErrorCode.NOT_FOUND
    case 409:
      return ApiErrorCode.CONFLICT
    case 422:
      return ApiErrorCode.INVALID_TRANSITION
    case 429:
      return ApiErrorCode.RATE_LIMITED
    default:
      return ApiErrorCode.INTERNAL_ERROR
  }
}

/**
 * Menormalisasi error apa pun menjadi envelope API.
 * Detail internal (stack, pesan driver) tidak pernah ikut ke klien untuk 5xx.
 */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof ApiError) return normalized(err)

  if (err instanceof ZodError) {
    return normalized(badRequest('Input tidak valid', zodDetails(err)))
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = fromPrisma(err)
    if (mapped) return mapped
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return normalized(badRequest('Input tidak valid'))
  }

  // State machine eskalasi melempar InvalidTransitionError sendiri (modules/escalation).
  // Dicocokkan lewat name agar lib/ tidak bergantung pada modul domain.
  if (err instanceof Error && err.name === 'InvalidTransitionError') {
    return normalized(invalidTransition(err.message))
  }

  const statusCode = readStatusCode(err)
  if (statusCode !== undefined && statusCode < 500) {
    const message = err instanceof Error ? err.message : 'Permintaan tidak dapat diproses'
    return normalized(new ApiError(statusCode, statusToCode(statusCode), message))
  }

  return {
    statusCode: 500,
    body: {
      error: { code: ApiErrorCode.INTERNAL_ERROR, message: 'Terjadi kesalahan pada server' },
    },
    isInternal: true,
  }
}

function readStatusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const status = (err as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : undefined
}

/** Mendaftarkan error handler + not-found handler agar seluruh respons seragam. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, body, isInternal } = normalizeError(err)

    if (isInternal) {
      req.log.error({ err, reqId: req.id }, 'unhandled error')
    } else {
      req.log.info({ code: body.error.code, statusCode, reqId: req.id }, 'request error')
    }

    return reply.code(statusCode).send(body)
  })

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(404).send(normalized(notFound(`Route ${req.method} ${req.url} tidak ada`)).body)
  })
}
