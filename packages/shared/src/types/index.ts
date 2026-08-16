import type { UserRole } from '../enums'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface ApiResponse<T> {
  data: T
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}

export interface AuthUserClaims {
  sub: string
  role: UserRole
  patientId?: string
  scope?: string
}
