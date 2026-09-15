// Unit test parser button_reply.id WhatsApp (CL-102).
// Ref: docs/TESTING.md §3-vii, AC "parser button_reply.id -> intent benar untuk semua kasus".
import { describe, expect, it } from 'vitest'
import {
  buildButtonId,
  call112Button,
  mapsButton,
  parseButtonReply,
  WaButtonIntent,
} from './parser'

const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'

describe('buildButtonId — format `<INTENT>_<resourceId>`', () => {
  it('CONFIRM_TAKEN + scheduleId', () => {
    expect(buildButtonId(WaButtonIntent.CONFIRM_TAKEN, SCHEDULE_ID)).toBe(
      `CONFIRM_TAKEN_${SCHEDULE_ID}`,
    )
  })
  it('HANDLE + runId', () => {
    expect(buildButtonId(WaButtonIntent.HANDLE, 'r1')).toBe('HANDLE_r1')
  })
})

describe('parseButtonReply', () => {
  it('mengurai CONFIRM_TAKEN_<id> -> intent CONFIRM_TAKEN + resource id', () => {
    expect(parseButtonReply(`CONFIRM_TAKEN_${SCHEDULE_ID}`)).toEqual({
      intent: 'CONFIRM_TAKEN',
      resourceId: SCHEDULE_ID,
      raw: `CONFIRM_TAKEN_${SCHEDULE_ID}`,
    })
  })

  it('mengurai DEFER_<id> -> intent DEFER + resource id', () => {
    expect(parseButtonReply(`DEFER_${SCHEDULE_ID}`)?.intent).toBe('DEFER')
    expect(parseButtonReply(`DEFER_${SCHEDULE_ID}`)?.resourceId).toBe(SCHEDULE_ID)
  })

  it('mengurai SAFE_<emergencyId> -> intent SAFE', () => {
    expect(parseButtonReply('SAFE_e1')?.intent).toBe('SAFE')
    expect(parseButtonReply('SAFE_e1')?.resourceId).toBe('e1')
  })

  it('mengurai NEED_HELP_<emergencyId> -> intent NEED_HELP', () => {
    expect(parseButtonReply('NEED_HELP_e1')).toEqual({
      intent: 'NEED_HELP',
      resourceId: 'e1',
      raw: 'NEED_HELP_e1',
    })
  })

  it('mengurai HANDLE_<runId> -> intent HANDLE + resource id', () => {
    expect(parseButtonReply('HANDLE_r1')).toEqual({
      intent: 'HANDLE',
      resourceId: 'r1',
      raw: 'HANDLE_r1',
    })
  })

  it('id intent tanpa resource id -> resourceId null (mis. SAFE)', () => {
    expect(parseButtonReply('SAFE')).toEqual({ intent: 'SAFE', resourceId: null, raw: 'SAFE' })
  })

  it('resource id yang mengandung underscore tidak terpotong', () => {
    expect(parseButtonReply('HANDLE_run_abc')?.resourceId).toBe('run_abc')
  })

  it('id tidak dikenal -> null', () => {
    expect(parseButtonReply('FOO_x')).toBeNull()
    expect(parseButtonReply('CONFIRM_FAILED_x')).toBeNull()
    expect(parseButtonReply('')).toBeNull()
  })

  it('URL deep-link (CALL_112 / MAPS) tidak di-parse sebagai intent', () => {
    expect(parseButtonReply('CALL_112')).toBeNull()
    expect(parseButtonReply('MAPS')).toBeNull()
  })
})

describe('tombol URL deep-link', () => {
  it('call112Button: url tel:112 (one-tap call, bukan auto-dial)', () => {
    expect(call112Button()).toEqual({
      type: 'URL',
      id: 'CALL_112',
      title: 'Hubungi 112',
      url: 'tel:112',
    })
  })

  it('mapsButton: url maps lokasi', () => {
    expect(mapsButton('https://maps.google.com/?q=-7.79,110.37')).toEqual({
      type: 'URL',
      id: 'MAPS',
      title: 'Buka Peta',
      url: 'https://maps.google.com/?q=-7.79,110.37',
    })
  })
})
