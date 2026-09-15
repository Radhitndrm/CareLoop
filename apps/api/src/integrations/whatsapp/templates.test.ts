// Unit test template pesan WhatsApp (CL-102).
// Ref: docs/TESTING.md §3-v, AC template reminder / darurat / tanpa PII berlebih.
import { describe, expect, it } from 'vitest'
import {
  buildEscalationBody,
  buildFamilyAlertBody,
  buildNakesAlertBody,
  buildPatientConfirmBody,
  buildReminderBody,
} from './templates'
import type { WaButton } from './types'

const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const EMERGENCY_ID = 'e1'
const RUN_ID = 'r1'

describe('buildReminderBody — template reminder', () => {
  const body = buildReminderBody(
    { medicationName: 'Metformin 500 mg', doseQty: '1 tablet', timeOfDay: '08:00' },
    SCHEDULE_ID,
  )

  it('memuat nama obat, dosis, waktu', () => {
    expect(body.body).toContain('Metformin 500 mg')
    expect(body.body).toContain('1 tablet')
    expect(body.body).toContain('08:00')
  })

  it('button ids benar: CONFIRM_TAKEN_<scheduleId> dan DEFER_<scheduleId>', () => {
    const ids = body.buttons.map((b: WaButton) => b.id)
    expect(ids).toEqual([`CONFIRM_TAKEN_${SCHEDULE_ID}`, `DEFER_${SCHEDULE_ID}`])
  })

  it('tombol Sudah Minum / Tunda 15 menit bertipe REPLY', () => {
    expect(body.buttons.map((b: WaButton) => b.type)).toEqual(['REPLY', 'REPLY'])
    expect(body.buttons[0].title).toBe('Sudah Minum')
    expect(body.buttons[1].title).toBe('Tunda 15 menit')
  })

  it('tidak membocorkan PII (NIK/HP) yang ada di data sumber', () => {
    const row = {
      medicationName: 'Amlodipin 5 mg',
      doseQty: '1 tablet',
      timeOfDay: '20:00',
      nik: '3404081234567890',
      phone: '081200000001',
    }
    const b = buildReminderBody(
      { medicationName: row.medicationName, doseQty: row.doseQty, timeOfDay: row.timeOfDay },
      SCHEDULE_ID,
    )
    expect(b.body).toContain('Amlodipin 5 mg')
    expect(b.body).not.toContain('3404081234567890')
    expect(b.body).not.toContain('081200000001')
  })
})

describe('buildPatientConfirmBody — konfirmasi pasien saat anomali', () => {
  const body = buildPatientConfirmBody('Deteksi detak jantung tinggi (145 bpm)', EMERGENCY_ID)

  it('berisi konteks anomali & pertanyaan aman', () => {
    expect(body.body).toContain('Deteksi detak jantung tinggi')
    expect(body.body).toContain('Apakah Anda aman?')
  })

  it('button ids SAFE_<emergencyId> dan NEED_HELP_<emergencyId>', () => {
    const ids = body.buttons.map((b: WaButton) => b.id)
    expect(ids).toEqual([`SAFE_${EMERGENCY_ID}`, `NEED_HELP_${EMERGENCY_ID}`])
  })
})

describe('buildEscalationBody — template darurat/eskalasi', () => {
  const data = {
    patientName: 'Bu Ratna',
    context:
      'Bu Ratna tidak merespons konfirmasi minum obat dan deteksi detak jantung tidak normal.',
    location: {
      label: 'Kel. Umbulharjo, Yogyakarta',
      mapsUrl: 'https://maps.google.com/?q=-7.79,110.37',
    },
    instruction: 'Segera hubungi atau cek kondisi Bu Ratna.',
  }

  it('berisi nama pasien, lokasi + maps link, instruksi', () => {
    const body = buildFamilyAlertBody(data, RUN_ID)
    expect(body.body).toContain('Bu Ratna')
    expect(body.body).toContain('Kel. Umbulharjo')
    expect(body.body).toContain('https://maps.google.com/?q=-7.79,110.37')
    expect(body.body).toContain('Segera hubungi atau cek kondisi Bu Ratna')
  })

  it('menyertakan tel:112 (one-tap call, bukan auto-dial)', () => {
    const call112 = buildFamilyAlertBody(data, RUN_ID).buttons.find(
      (b: WaButton) => b.type === 'URL' && b.url === 'tel:112',
    )
    expect(call112).toBeDefined()
    expect(call112).toMatchObject({ id: 'CALL_112', title: 'Hubungi 112' })
  })

  it('menyertakan tombol HANDLE_<runId> dan tombol maps', () => {
    const ids = buildFamilyAlertBody(data, RUN_ID).buttons.map((b: WaButton) => b.id)
    expect(ids).toContain(`HANDLE_${RUN_ID}`)
    expect(ids).toContain('MAPS')
  })

  it('tanpa lokasi -> keterangan "Lokasi: tidak tersedia", tanpa tombol MAPS', () => {
    const body = buildFamilyAlertBody({ ...data, location: null }, RUN_ID)
    expect(body.body).toContain('Lokasi: tidak tersedia')
    expect(body.buttons.some((b: WaButton) => b.id === 'MAPS')).toBe(false)
  })

  it('showCall112=false -> tidak ada tel:112 namun HANDLE tetap ada', () => {
    const body = buildEscalationBody({ ...data, showCall112: false }, RUN_ID, 'Alert Keluarga')
    expect(body.buttons.some((b: WaButton) => b.type === 'URL' && b.url === 'tel:112')).toBe(false)
    expect(body.buttons.map((b: WaButton) => b.id)).toContain(`HANDLE_${RUN_ID}`)
  })

  it('tidak menyertakan PII berlebih (NIK/tanggal lahir) walau ada di data sumber', () => {
    const row = {
      patientName: 'Bu Ratna',
      nik: '3404081234567890',
      dateOfBirth: '1954-03-11',
    }
    const body = buildNakesAlertBody({ ...data, patientName: row.patientName }, RUN_ID)
    expect(body.body).toContain('Bu Ratna')
    expect(body.body).not.toContain(row.nik)
    expect(body.body).not.toContain(row.dateOfBirth)
    expect(body.body).not.toContain('1954')
  })
})

describe('buildNakesAlertBody — alert prioritas nakes', () => {
  it('selalu menyertakan maps + call 112 saat lokasi ada', () => {
    const body = buildNakesAlertBody(
      {
        patientName: 'Bu Ratna',
        context: 'Pasien tinggal sendiri dan tidak merespons.',
        location: { label: 'Yogyakarta', mapsUrl: 'https://maps.google.com/?q=-7.79,110.37' },
        instruction: 'Mohon cek kondisi pasien.',
      },
      RUN_ID,
    )
    const ids = body.buttons.map((b: WaButton) => b.id)
    expect(ids).toContain('MAPS')
    expect(ids).toContain('CALL_112')
    expect(body.header).toBe('Alert Nakes')
  })

  it('tidak menyertakan NIK/HP (PII minimal)', () => {
    const body = buildNakesAlertBody(
      {
        patientName: 'Bu Ratna',
        context: 'x',
        location: null,
        instruction: 'y',
      },
      RUN_ID,
    )
    expect(body.body).not.toContain('nik')
    expect(body.body).not.toContain('+628')
    expect(body.body).not.toContain('telepon pasien')
  })
})
