// Kirim tombol konfirmasi setelah pasien menekan quick-reply pada message template.
//
// Alur produksi (§ docs/WHATSAPP-SETUP.md §4.1): pengingat terjadwal dikirim sebagai
// template dengan satu tombol quick-reply.payload `KONFIRMS`. Pasien mengetuknya, dan
// Meta mengirim `button_reply` — **jendela layanan 24 jam pun terbuka** karena itu pesan
// dari pengguna. CareLoop lalu mengirim pesan lanjutan berisi tombol interaktif yang
// sesungguhnya (`CONFIRM_TAKEN_<scheduleId>`), yang kembali ke alur `dispatchWaIntent`
// yang sama seperti mode mock.
//
// Pemetaan template → jadwal memakai `interactive.context.id`, yaitu id pesan yang
// dibalas, dicocokkan ke `reminder_logs.provider_message_id`. Payload quick-reply sendiri
// tidak bisa membawa jadwal: nilainya ditetapkan Meta saat template disetujui.
import type { PrismaClient } from '@prisma/client'
import { buildReminderBody } from '../../integrations/whatsapp/templates'
import type { WhatsAppService } from '../../integrations/whatsapp/whatsapp.service'

/** Awalan `messageKey` pada escalation_steps untuk menandai tombol konfirmasi dikirim. */
export const CONFIRM_BUTTONS_STEP_KEY = 'reminder.confirm_buttons'

/**
 * `messageKey` per pesan template.
 *
 * Harus memuat `contextMessageId`, bukan konstan: satu jadwal punya banyak slot harian,
 * jadi bila key-nya sama, tombol slot ke-2 akan ikut tertahan sebagai "sudah dikirim".
 * `messageKey` adalah TEXT tanpa batas panjang, jadi aman.
 */
export function confirmButtonsMessageKey(contextMessageId: string): string {
  return `${CONFIRM_BUTTONS_STEP_KEY}:${contextMessageId}`
}

export interface SendConfirmButtonsInput {
  /** `interactive.context.id` — pesan template yang dijawab pasien. */
  contextMessageId: string | null
  /** Nomor pengirim (E.164) — tujuan pesan tombol. */
  from: string
  providerMessageId?: string | null
  now?: Date
}

export interface SendConfirmButtonsResult {
  sent: boolean
  scheduleId: string | null
  /** Alasan kalau tidak terkirim — untuk audit, bukan untuk ditampilkan ke pasien. */
  reason: string | null
  /** true kalau tombol sebelumnya sudah dikirim, jadi pengiriman ini dilewati. */
  alreadySent: boolean
}

type ButtonsClient = Pick<
  PrismaClient,
  'reminderLog' | 'schedule' | 'escalationRun' | 'escalationStep' | 'medication'
>

/**
 * Kirim tombol "Sudah Minum" / "Tunda 15 menit" untuk jadwal yang reminder-nya
 * baru saja dijawab pasien lewat template.
 *
 * Idempoten: bila tombol untuk jadwal yang sama sudah pernah dikirim, tidak dikirim
 * ulang. Meta memang bisa mengirim ulang `update` yang sama, dan tanpa guard ini
 * pasien akan menerima tombol berulang-ulang.
 */
export async function sendReminderConfirmButtons(
  client: ButtonsClient,
  whatsapp: WhatsAppService,
  input: SendConfirmButtonsInput,
): Promise<SendConfirmButtonsResult> {
  const scheduleId = await resolveScheduleId(client, input.contextMessageId)

  if (!scheduleId) {
    return {
      sent: false,
      scheduleId: null,
      reason: 'Tidak ada reminder_log yang cocok dengan pesan template yang dibalas',
      alreadySent: false,
    }
  }

  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      patientId: true,
      timeOfDay: true,
      doseQty: true,
      medication: { select: { name: true } },
    },
  })

  if (!schedule) {
    return { sent: false, scheduleId, reason: `Jadwal ${scheduleId} tidak ada`, alreadySent: false }
  }

  const messageKey = confirmButtonsMessageKey(input.contextMessageId as string)

  // Idempotensi dicek lewat `messageKey`, bukan lewat run: Meta bisa mengirim ulang
  // balasan yang sama, dan saat itu run-nya mungkin sudah tertutup karena pasien
  // ternyata mengonfirmasi lewat cara lain.
  const already = await client.escalationStep.findFirst({
    where: { messageKey },
    select: { id: true },
  })
  if (already) {
    return { sent: false, scheduleId, reason: 'Tombol konfirmasi sudah dikirim', alreadySent: true }
  }

  // Run terakhir dipakai hanya sebagai tempat mencatat langkah. Status sengaja tidak
  // difilter: kalau eskalasi sudah ditutup, tombol tetap perlu dikirim dan dicatat.
  const run = await client.escalationRun.findFirst({
    where: { sourceScheduleId: schedule.id },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })

  const result = await whatsapp.sendInteractive(
    input.from,
    buildReminderBody(
      {
        medicationName: schedule.medication?.name ?? 'Obat',
        doseQty: schedule.doseQty,
        timeOfDay: schedule.timeOfDay,
      },
      schedule.id,
    ),
  )

  if (run) {
    await client.escalationStep.create({
      data: {
        runId: run.id,
        contactPhone: input.from,
        channel: 'WHATSAPP',
        messageKey,
        sentAt: input.now ?? new Date(),
        providerMessageId: result.providerMessageId,
      },
    })
  }

  return { sent: true, scheduleId, reason: null, alreadySent: false }
}

/**
 * Temukan jadwal yang diacak ke pesan template.
 *
 * Jalur utama: `interactive.context.id` → `reminder_logs.provider_message_id`.
 * Jalur cadangan: run eskalasi aktif terakhir pasien — dipakai kalau log-nya sudah
 * terpotong (mis. retention), dan tetap lebih baik daripada tidak mengirim tombol.
 */
async function resolveScheduleId(
  client: ButtonsClient,
  contextMessageId: string | null,
): Promise<string | null> {
  if (contextMessageId) {
    const log = await client.reminderLog.findFirst({
      where: { providerMessageId: contextMessageId },
      select: { scheduleId: true },
    })
    if (log) return log.scheduleId
  }
  return null
}
