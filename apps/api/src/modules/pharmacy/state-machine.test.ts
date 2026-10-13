// State machine permintaan obat (docs/API.md §3.6, test SR-1..SR-4).
//
// Diuji tanpa database: aturan transisi harus berdiri sendiri sebagai kontrak
// yang bisa dibaca developer tanpa membuka service.
import { describe, expect, it } from 'vitest'
import { MedicationRequestAction, MedicationRequestStatus } from '@careloop/shared'
import {
  describeAllowed,
  InvalidPharmacyTransitionError,
  isOverdue,
  isTerminal,
  pharmacistActionsFor,
  PHARMACY_ALLOWED_ACTIONS,
  reducePharmacy,
  type PharmacyState,
} from './state-machine'

const ALL_STATES = Object.values(MedicationRequestStatus)
const ALL_EVENTS = Object.values(MedicationRequestAction)

describe('PHARMACY_ALLOWED_ACTIONS', () => {
  it('PENDING_DOCTOR hanya boleh disetujui atau ditolak', () => {
    expect(PHARMACY_ALLOWED_ACTIONS.PENDING_DOCTOR).toEqual([
      MedicationRequestAction.APPROVED,
      MedicationRequestAction.REJECTED,
    ])
  })

  it('tidak ada aksi yang boleh practiced langsung ke DISPENSED dari PENDING_DOCTOR', () => {
    expect(PHARMACY_ALLOWED_ACTIONS.PENDING_DOCTOR).not.toContain(
      MedicationRequestAction.DISPENSED,
    )
  })

  it('hanya READY boleh DISPENSED', () => {
    const statesAllowingDispensed = ALL_STATES.filter((state) =>
      PHARMACY_ALLOWED_ACTIONS[state].includes(MedicationRequestAction.DISPENSED),
    )
    expect(statesAllowingDispensed).toEqual([MedicationRequestStatus.READY])
  })

  it('status final tidak punya aksi keluar', () => {
    for (const state of [
      MedicationRequestStatus.DISPENSED,
      MedicationRequestStatus.REJECTED,
      MedicationRequestStatus.OUT_OF_STOCK,
      MedicationRequestStatus.SUBSTITUTED,
    ]) {
      expect(PHARMACY_ALLOWED_ACTIONS[state]).toEqual([])
      expect(isTerminal(state)).toBe(true)
    }
  })
})

describe('reducePharmacy — jalur normal', () => {
  it('APPROVED memindahkan PENDING_DOCTOR ke QUEUED', () => {
    expect(
      reducePharmacy(MedicationRequestStatus.PENDING_DOCTOR, MedicationRequestAction.APPROVED).to,
    ).toBe(MedicationRequestStatus.QUEUED)
  })

  it('REJECTED memindahkan PENDING_DOCTOR ke REJECTED', () => {
    expect(
      reducePharmacy(MedicationRequestStatus.PENDING_DOCTOR, MedicationRequestAction.REJECTED).to,
    ).toBe(MedicationRequestStatus.REJECTED)
  })

  it('rantai antrean berjalan QUEUED -> PREPARING -> READY -> DISPENSED', () => {
    let state: PharmacyState = MedicationRequestStatus.QUEUED
    state = reducePharmacy(state, MedicationRequestAction.START_PREPARING).to
    expect(state).toBe(MedicationRequestStatus.PREPARING)
    state = reducePharmacy(state, MedicationRequestAction.MARK_READY).to
    expect(state).toBe(MedicationRequestStatus.READY)
    state = reducePharmacy(state, MedicationRequestAction.DISPENSED).to
    expect(state).toBe(MedicationRequestStatus.DISPENSED)
  })

  it('stok kosong & penggantian bisa dicatat dari antrean, menyiapkan, maupun siap', () => {
    const sources = [
      MedicationRequestStatus.QUEUED,
      MedicationRequestStatus.PREPARING,
      MedicationRequestStatus.READY,
    ]
    for (const source of sources) {
      expect(
        reducePharmacy(source, MedicationRequestAction.MARK_OUT_OF_STOCK).to,
      ).toBe(MedicationRequestStatus.OUT_OF_STOCK)
      expect(
        reducePharmacy(source, MedicationRequestAction.MARK_SUBSTITUTED).to,
      ).toBe(MedicationRequestStatus.SUBSTITUTED)
    }
  })

  it('READY bisa dikembalikan ke antrean saat giliran terpakai', () => {
    expect(
      reducePharmacy(MedicationRequestStatus.READY, MedicationRequestAction.RETURNED_TO_QUEUE).to,
    ).toBe(MedicationRequestStatus.QUEUED)
  })
})

describe('reducePharmacy — transisi tidak valid', () => {
  it('PENDING_DOCTOR tidak boleh langsung DISPENSED (SR-1)', () => {
    expect(() =>
      reducePharmacy(MedicationRequestStatus.PENDING_DOCTOR, MedicationRequestAction.DISPENSED),
    ).toThrow(InvalidPharmacyTransitionError)
  })

  it('QUEUED tidak boleh MARK_READY tanpa lewat PREPARING (SR-2)', () => {
    expect(() =>
      reducePharmacy(MedicationRequestStatus.QUEUED, MedicationRequestAction.MARK_READY),
    ).toThrow(/tidak bisa diubah/)
  })

  it('DISPENSED tidak bisa diubah lagi (SR-3)', () => {
    expect(() =>
      reducePharmacy(MedicationRequestStatus.DISPENSED, MedicationRequestAction.MARK_READY),
    ).toThrow(InvalidPharmacyTransitionError)
  })

  it('REJECTED tidak bisa disetujui ulang (SR-4)', () => {
    expect(() =>
      reducePharmacy(MedicationRequestStatus.REJECTED, MedicationRequestAction.APPROVED),
    ).toThrow(InvalidPharmacyTransitionError)
  })

  it('CREATED tidak pernah jadi transisi — hanya jejak audit', () => {
    for (const state of ALL_STATES) {
      expect(() => reducePharmacy(state, MedicationRequestAction.CREATED)).toThrow(
        InvalidPharmacyTransitionError,
      )
    }
  })

  it('setiap kombinasi state x aksi yang tidak diizinkan melempar', () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const allowed = PHARMACY_ALLOWED_ACTIONS[state].includes(event)
        if (allowed) {
          expect(() => reducePharmacy(state, event)).not.toThrow()
        } else {
          expect(() => reducePharmacy(state, event)).toThrow(InvalidPharmacyTransitionError)
        }
      }
    }
  })
})

describe('describeAllowed', () => {
  it('menyebutkan aksi yang sah agar pesan error bisa ditindaklanjuti', () => {
    expect(describeAllowed(MedicationRequestStatus.PENDING_DOCTOR)).toContain('APPROVED')
    expect(describeAllowed(MedicationRequestStatus.QUEUED)).toContain('START_PREPARING')
  })

  it('status final diberi tahu bahwa tidak ada aksi tersisa', () => {
    expect(describeAllowed(MedicationRequestStatus.DISPENSED)).toMatch(/tidak ada/)
  })
})

describe('pharmacistActionsFor', () => {
  it('hanya status aktif yang punya aksi farmasi', () => {
    expect(pharmacistActionsFor(MedicationRequestStatus.QUEUED)).toContain(
      MedicationRequestAction.START_PREPARING,
    )
    expect(pharmacistActionsFor(MedicationRequestStatus.READY)).toContain(
      MedicationRequestAction.DISPENSED,
    )
    expect(pharmacistActionsFor(MedicationRequestStatus.PENDING_DOCTOR)).toEqual([])
    expect(pharmacistActionsFor(MedicationRequestStatus.DISPENSED)).toEqual([])
  })
})

describe('isOverdue — turunan, bukan status', () => {
  const now = new Date('2026-10-11T08:00:00.000Z')

  it('QUEUED yang jatuh tempo lewat dihitung terlambat', () => {
    expect(isOverdue(MedicationRequestStatus.QUEUED, new Date('2026-10-09T00:00:00Z'), now)).toBe(true)
  })

  it('jatuh tempo hari ini belum terlambat — diminum hari ini masih wajar', () => {
    expect(isOverdue(MedicationRequestStatus.QUEUED, new Date('2026-10-11T00:00:00Z'), now)).toBe(false)
  })

  it('jatuh tempo besok belum terlambat', () => {
    expect(isOverdue(MedicationRequestStatus.QUEUED, new Date('2026-10-12T00:00:00Z'), now)).toBe(false)
  })

  it('PREPARING & READY juga bisa terlambat', () => {
    for (const status of [
      MedicationRequestStatus.PREPARING,
      MedicationRequestStatus.READY,
    ]) {
      expect(isOverdue(status, new Date('2026-10-01T00:00:00Z'), now)).toBe(true)
    }
  })

  it('status final tidak pernah terlambat', () => {
    for (const status of [
      MedicationRequestStatus.DISPENSED,
      MedicationRequestStatus.REJECTED,
      MedicationRequestStatus.OUT_OF_STOCK,
      MedicationRequestStatus.SUBSTITUTED,
      MedicationRequestStatus.PENDING_DOCTOR,
    ]) {
      expect(isOverdue(status, new Date('2026-01-01T00:00:00Z'), now)).toBe(false)
    }
  })
})