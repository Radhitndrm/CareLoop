// Notifikasi alur farmasi (docs/API.md §3.6).
//
// Dua kanal:
// - WhatsApp ke pasien (+ keluarga) untuk hal yang pasien harus tahu: disetujui,
//   ditolak, siap diambil, stok kosong, obat diganti.
// - In-app ke dokter penanggung jawab untuk hal yang butuh keputusan klinis:
//   permintaan baru menunggu persetujuan, dan penyesuaian resep setelah
//   apotek menandai stok kosong / penggantian.
//
// Prinsip yang diwarisi dari reminder & eskalasi: kegagalan mengirim TIDAK
// boleh membatalkan aksi utama. Status request sudah tersimpan di database;
// pesan WhatsApp yang gagal cukup dicatat sebagai Notification berstatus FAILED
// agar bisa dikirim ulang nanti (CL-209).
import { NotificationType, type MedicationRequestStatus } from '@careloop/shared'
import {
  buildMedicationRequestApprovedTemplate,
  buildMedicationRequestRejectedTemplate,
  buildMedicationReadyTemplate,
  buildOutOfStockTemplate,
  buildRoutineRefillTemplate,
  buildSubstitutedTemplate,
  type PharmacyTemplateData,
} from '../../integrations/whatsapp/templates'
import { getWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import { toWaId } from '../../integrations/whatsapp/whatsapp.service'

export type NotificationPrismaClient = {
  notification: {
    create(args: any): Promise<any>
    createMany(args: any): Promise<any>
  }
  familyContact: { findMany(args: any): Promise<any[]> }
  nakesContact: { findMany(args: any): Promise<any[]> }
}

export interface NotifyRequestContext {
  patientId: string
  patientName: string
  patientPhone: string
  medicationName: string
  quantityDays: number
  dueAt: Date
}

/**
 * Kirim satu pesan ke pasien dan seluruh kontak keluarga aktif.
 *
 * Setiap penerima dicatat sebagai baris Notification terpisah supaya status
 * pengiriman per nomor bisa dilihat. Kegagalan satu nomor tidak menghentikan
 * nomor berikutnya.
 */
async function sendToPatientAndFamily(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  notificationType: NotificationType,
  title: string,
  text: string,
  logger?: { warn(obj: unknown, msg: string): void },
): Promise<void> {
  const familyContacts = await client.familyContact.findMany({
    where: { patientId: ctx.patientId, isActive: true },
    select: { phone: true },
  })

  const recipients: Array<{ phone: string; isFamily: boolean }> = [
    { phone: ctx.patientPhone, isFamily: false },
    ...familyContacts.map((c) => ({ phone: c.phone, isFamily: true })),
  ]

  const service = getWhatsAppService()

  for (const recipient of recipients) {
    try {
      const result = await service.sendText(recipient.phone, text)
      await client.notification.create({
        data: {
          patientId: ctx.patientId,
          channel: 'WHATSAPP',
          type: notificationType,
          title,
          body: text,
          status: 'SENT',
          // providerMessageId UNIK di database. Mock provider mengulang penomoran
          // dari awal tiap process restart, jadi id itu tidak boleh dipakai
          // mentah-mentah — kalau tidak, baris notifikasi kedua untuk demo yang
          // sama akan ditolak P2002 dan pengiriman dianggap gagal.
          ...(result.providerMessageId
            ? { providerMessageId: `${result.providerMessageId}-${notificationType}-${ctx.patientId}-${recipient.phone}` }
            : {}),
          sentAt: result.sentAt,
        },
      })
    } catch (error) {
      logger?.warn(
        { err: error, isFamily: recipient.isFamily, patientId: ctx.patientId },
        'gagal mengirim notifikasi farmasi via WhatsApp',
      )
      await client.notification
        .create({
          data: {
            patientId: ctx.patientId,
            channel: 'WHATSAPP',
            type: notificationType,
            title,
            body: text,
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined)
    }
  }
}

/** In-app ke dokter penanggung jawab pasien — butuh tindakan klinis berikutnya. */
async function notifyDoctor(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  title: string,
  body: string,
  payload?: Record<string, unknown>,
  logger?: { warn(obj: unknown, msg: string): void },
): Promise<void> {
  try {
    const contacts = await client.nakesContact.findMany({
      where: { patientId: ctx.patientId, isActive: true, nakesUserId: { not: null } },
      select: { nakesUserId: true },
    })
    const doctorIds = [...new Set(contacts.map((c) => c.nakesUserId).filter(Boolean))] as string[]
    if (doctorIds.length === 0) return

    await client.notification.createMany({
      data: doctorIds.map((userId) => ({
        userId,
        patientId: ctx.patientId,
        channel: 'IN_APP' as const,
        type: NotificationType.REFILL,
        title,
        body,
        ...(payload ? { payload } : {}),
        status: 'PENDING' as const,
      })),
    })
  } catch (error) {
    logger?.warn({ err: error, patientId: ctx.patientId }, 'gagal membuat notifikasi in-app untuk dokter')
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

function templateData(ctx: NotifyRequestContext): PharmacyTemplateData {
  return {
    patientName: ctx.patientName,
    medicationName: ctx.medicationName,
    quantityDays: ctx.quantityDays,
    pickupDate: formatDate(ctx.dueAt),
  }
}

type Logger = { warn(obj: unknown, msg: string): void }

/** Permintaan pasien disetujui dokter dan masuk antrean. */
export async function notifyRequestApproved(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Permintaan obat disetujui',
    buildMedicationRequestApprovedTemplate(templateData(ctx)),
    logger,
  )
}

/** Permintaan ditolak dokter — patient's kenapa WAJIB ikut, itu tujuan penolakan. */
export async function notifyRequestRejected(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  reason: string,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Permintaan obat ditolak',
    buildMedicationRequestRejectedTemplate(templateData(ctx), reason),
    logger,
  )
}

/** Obat siap diambil — dikirim ke pasien dan keluarga supaya bisa Antar/mengingatkan. */
export async function notifyMedicationReady(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Obat siap diambil',
    buildMedicationReadyTemplate(templateData(ctx)),
    logger,
  )
}

/** Stok kosong: pasien diberi tahu, dokter diminta menyesuaikan resep. */
export async function notifyOutOfStock(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  reason: string,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Stok obat kosong',
    buildOutOfStockTemplate(templateData(ctx), reason),
    logger,
  )
  await notifyDoctor(
    client,
    ctx,
    'Stok obat kosong',
    `${ctx.medicationName} kosong untuk ${ctx.patientName}. Perlu penyesuaian resep.`,
    { reason },
    logger,
  )
}

/** Obat diganti: pasien diberi tahu nama penggantinya, dokter diminta mengesahkan. */
export async function notifySubstituted(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  substituteName: string,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Obat diganti',
    buildSubstitutedTemplate(templateData(ctx), substituteName),
    logger,
  )
  await notifyDoctor(
    client,
    ctx,
    'Penggantian obat perlu persetujuan',
    `Apotek mengganti ${ctx.medicationName} dengan ${substituteName} untuk ${ctx.patientName}. Mohon sesuaikan resep.`,
    { substituteName },
    logger,
  )
}

/** Permintaan rutin otomatis dibuat oleh scheduler. */
export async function notifyRoutineRefill(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  logger?: Logger,
): Promise<void> {
  await sendToPatientAndFamily(
    client,
    ctx,
    NotificationType.REFILL,
    'Pengambilan obat',
    buildRoutineRefillTemplate(templateData(ctx)),
    logger,
  )
}

/** Permintaan baru menunggu persetujuan dokter. */
export async function notifyDoctorOfNewRequest(
  client: NotificationPrismaClient,
  ctx: NotifyRequestContext,
  logger?: Logger,
): Promise<void> {
  await notifyDoctor(
    client,
    ctx,
    'Permintaan obat menunggu persetujuan',
    `${ctx.patientName} meminta ${ctx.quantityDays} hari ${ctx.medicationName}.`,
    { medicationName: ctx.medicationName, quantityDays: ctx.quantityDays },
    logger,
  )
}

/** Nomor WA untuk debug/test — memastikan normalisasi 08… -> 62… benar. */
export function pharmacyWaId(phone: string): string {
  return toWaId(phone)
}

export type { MedicationRequestStatus }