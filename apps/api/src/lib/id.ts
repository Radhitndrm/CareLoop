import { randomUUID } from 'node:crypto'

/** Semua id domain memakai uuid v4 (docs/DATABASE.md §1). */
export function newId(): string {
  return randomUUID()
}

export function nowUtc(): Date {
  return new Date()
}
