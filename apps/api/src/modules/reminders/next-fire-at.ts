// Util kalkulasi jadwal reminder (CL-105).
// Murni, tanpa IO & tanpa dependency baru: menghitung kapan sebuah Schedule "fire"
// berikutnya dari jam wall-clock pasien + hari aktif, lalu mengonversi ke instant UTC
// (kontrak docs/DATABASE.md: backend selalu menyimpan waktu UTC).
// Zona waktu memakai data IANA bawaan Node (Intl), jadi WIB/WITA/WIT ditangani tanpa library.

export interface ReminderScheduleInput {
  /** Jam wall-clock pasien "HH:mm" (docs/DATABASE.md §3.6). */
  timeOfDay: string
  /** Hari aktif 1=Senin..7=Minggu (ISO). Array kosong / tidak diisi = setiap hari. */
  daysOfWeek?: number[]
  /** Zona waktu IANA pasien (users.timezone, default Asia/Jakarta). */
  timezone?: string
  /** Batas awal (inklusif) — tanggal lokal pasien, "YYYY-MM-DD" atau Date. */
  startDate?: string | Date
  /** Batas akhir (inklusif) — tanggal lokal pasien, "YYYY-MM-DD" atau Date. */
  endDate?: string | Date
}

export interface NextFireAtOptions {
  /** Instant referensi; default = sekarang. Hasil dijamin lebih besar dari after. */
  after?: Date | string
}

const MAX_DAYS_AHEAD = 366 * 2

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function localParts(date: Date, timeZone: string): LocalParts {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    })
    formatterCache.set(timeZone, formatter)
  }

  const raw: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) raw[part.type] = part.value

  let hour = Number(raw.hour)
  if (hour === 24) hour = 0

  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour,
    minute: Number(raw.minute),
    weekday: WEEKDAY_INDEX[raw.weekday] ?? 0,
  }
}

/**
 * Instant UTC yang lokalnya (di timeZone) tepat sama dengan jam wall-clock yang diminta.
 * Teknik tebak-tesubi: mulai dari "seakan-akan wall-clock itu sudah UTC", lalu koreksi
 * selisih offset hingga konvergen. Stabil untuk offset tetap (tidak ada DST di Indonesia).
 */
function utcFromWallTime(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const targetWall = Date.UTC(year, month - 1, day, hour, minute)
  let guess = targetWall

  for (let i = 0; i < 3; i++) {
    const parts = localParts(new Date(guess), timeZone)
    const actualWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const delta = targetWall - actualWall
    if (delta === 0) break
    guess += delta
  }

  return new Date(guess)
}

function parseTime(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) throw new RangeError(`timeOfDay harus format HH:mm, terima "${value}"`)

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new RangeError(`timeOfDay di luar rentang (${value})`)

  return [hour, minute]
}

function localDateKey(parts: LocalParts): string {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

/** Normalisasi input tanggal ke kunci "YYYY-MM-DD" versi tanggal lokal pasien. */
function toLocalDateKey(value: string | Date, timeZone: string): string {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (match) return value.trim()
  }
  return localDateKey(localParts(new Date(value), timeZone))
}

/**
 * Kapan jadwal berikutnya akan fire, dalam UTC.
 * Memperhitungkan zona pasien (timeOfDay di zona lokal), filter daysOfWeek,
 * serta batas startDate/endDate. Mengembalikan null bila tidak ada slot valid
 * dalam 2 tahun ke depan.
 */
export function nextFireAt(
  schedule: ReminderScheduleInput,
  options: NextFireAtOptions = {},
): Date | null {
  const timezone = schedule.timezone ?? 'Asia/Jakarta'
  const daysOfWeek = schedule.daysOfWeek

  const [hour, minute] = parseTime(schedule.timeOfDay)
  const after =
    options.after === undefined
      ? new Date()
      : typeof options.after === 'string'
        ? new Date(options.after)
        : new Date(options.after.getTime())
  const afterMs = after.getTime()

  const startKey =
    schedule.startDate === undefined ? null : toLocalDateKey(schedule.startDate, timezone)
  const endKey = schedule.endDate === undefined ? null : toLocalDateKey(schedule.endDate, timezone)

  // Iterasi per tanggal lokal (dikunci pada 12:00 waktu setempat saat maju satu hari
  // supaya penjumlahan hari tidak melompati/memotong hari karena offset berubah).
  let ref: Date = after
  for (let day = 0; day < MAX_DAYS_AHEAD; day++) {
    const parts = localParts(ref, timezone)
    const dateKey = localDateKey(parts)
    const fire = utcFromWallTime(timezone, parts.year, parts.month, parts.day, hour, minute)

    if (
      fire.getTime() > afterMs &&
      (startKey === null || dateKey >= startKey) &&
      (endKey === null || dateKey <= endKey) &&
      (daysOfWeek === undefined || daysOfWeek.length === 0 || daysOfWeek.includes(parts.weekday))
    ) {
      return fire
    }

    const noon = utcFromWallTime(timezone, parts.year, parts.month, parts.day, 12, 0)
    ref = new Date(noon.getTime() + 86_400_000)
  }

  return null
}
