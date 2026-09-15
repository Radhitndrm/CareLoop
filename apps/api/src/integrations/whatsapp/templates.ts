// Template pesan WhatsApp (CL-102) — komposisi teks + tombol interaktif
// untuk reminder, konfirmasi pasien, dan alert eskalasi/darurat.
// Memakai WaInteractiveBody supaya pemanggil cukup service.sendInteractive(to, body).
// Pesan menghadap pengguna berbahasa Indonesia. PII dibatasi: nama pasien/obat boleh;
// NIK, tanggal lahir, no. HP, alamat lengkap TIDAK dimasukkan ke template.
import { WaButtonIntent, buildButtonId, call112Button, mapsButton } from './parser'
import type { WaButton, WaInteractiveBody } from './types'

export interface ReminderTemplateData {
  medicationName: string
  doseQty: string
  timeOfDay: string
}

export interface EscalationAlertData {
  /** Nama pasien (boleh — konteks eskalasi). Bukan NIK/tanggal lahir. */
  patientName: string
  /** Alasan/konteks, mis. "tidak merespons konfirmasi minum obat" atau "deteksi detak jantung tinggi". */
  context: string
  location?: { label: string; mapsUrl: string } | null
  instruction: string
  /** Sertakan tombol one-tap call 112 (deep-link tel:112, tanpa auto-dial). */
  showCall112?: boolean
}

/** Reminder minum obat: isi pesan (obat/dosis/waktu) + tombol Sudah Minum / Tunda 15 menit. */
export function buildReminderBody(
  data: ReminderTemplateData,
  scheduleId: string,
): WaInteractiveBody {
  return {
    body: `Ingatan minum obat: ${data.medicationName} - ${data.doseQty} pada pukul ${data.timeOfDay}. Sudah diminum?`,
    header: 'Minum Obat',
    footer: 'Tekan "Sudah Minum", atau "Tunda 15 menit" bila belum waktunya.',
    buttons: [
      {
        type: 'REPLY',
        id: buildButtonId(WaButtonIntent.CONFIRM_TAKEN, scheduleId),
        title: 'Sudah Minum',
      },
      {
        type: 'REPLY',
        id: buildButtonId(WaButtonIntent.DEFER, scheduleId),
        title: 'Tunda 15 menit',
      },
    ],
  }
}

/** Konfirmasi pasien saat anomali darurat: apakah aman? (FR-4.3 / AC-4.2). */
export function buildPatientConfirmBody(context: string, emergencyId: string): WaInteractiveBody {
  return {
    body: `${context}\n\nApakah Anda aman?`,
    header: 'Cek Kondisi',
    footer: 'Laporkan kondisi Anda dengan satu ketukan. Tidak merespons akan memicu bantuan.',
    buttons: [
      { type: 'REPLY', id: buildButtonId(WaButtonIntent.SAFE, emergencyId), title: 'Saya Aman' },
      {
        type: 'REPLY',
        id: buildButtonId(WaButtonIntent.NEED_HELP, emergencyId),
        title: 'Saya Butuh Bantuan',
      },
    ],
  }
}

function locationLine(location: EscalationAlertData['location']): string {
  return location
    ? `Lokasi: ${location.label}\nPeta: ${location.mapsUrl}`
    : 'Lokasi: tidak tersedia'
}

/** Alert eskalasi/darurat ke keluarga atau nakes: nama pasien, konteks, lokasi (opsional), instruksi, tel:112. */
export function buildEscalationBody(
  data: EscalationAlertData,
  runId: string,
  header: string,
): WaInteractiveBody {
  const buttons: WaButton[] = [
    { type: 'REPLY', id: buildButtonId(WaButtonIntent.HANDLE, runId), title: 'Saya Tangani' },
  ]
  if (data.location) buttons.push(mapsButton(data.location.mapsUrl))
  if (data.showCall112 !== false) buttons.push(call112Button())

  return {
    body: `${data.context}\nPasien: ${data.patientName}\n${locationLine(data.location)}\n\n${data.instruction}${
      data.showCall112 !== false
        ? '\n\nDarurat? Tekan "Hubungi 112" untuk memanggil pertolongan (one-tap, tanpa auto-dial).'
        : ''
    }`,
    header,
    footer: 'Tekan "Saya Tangani" jika Anda yang menangani.',
    buttons,
  }
}

/** Alert ke kontak keluarga (T1/T2) — jalur eskalasi kepatuhan maupun darurat. */
export function buildFamilyAlertBody(data: EscalationAlertData, runId: string): WaInteractiveBody {
  return buildEscalationBody(data, runId, 'Alert Keluarga')
}

/** Alert prioritas ke nakes/kader (jaring pengaman) — selalu sertakan maps + call 112. */
export function buildNakesAlertBody(data: EscalationAlertData, runId: string): WaInteractiveBody {
  return buildEscalationBody({ ...data, showCall112: true }, runId, 'Alert Nakes')
}
