// Scenario runner WhatsApp Simulator (plan tasks/plan-whatsapp-mockup-demo.md Fase 5-6).
//
// Setiap scenario memanggil service produksi yang sama dengan alur nyata — hanya waktu
// tunggunya yang dipendekkan. Tidak ada cabang bisnis khusus demo: yang dipanggil adalah
// `handleReminderJob`, `handleEscalationTimeout`, `createEmergencyFromAnomaly`, dan
// `dispatchWaIntent`, semuanya sudah dipakai jalur scheduler/webhook.
//
// Pasien & jadwal default memakai persona sintetis dari `prisma/personas.ts` supaya demo
// selalu punya data yang sama persis dengan seed dan integration test.
import { prisma } from '../../lib/prisma'
import { getEnv } from '../../lib/env'
import { notFound } from '../../lib/errors'
import {
  getWhatsAppSandbox,
  getWhatsAppService,
  MockWhatsAppProvider,
} from '../../integrations/whatsapp'
import { DEMO_IDS } from '../../../prisma/personas'
import {
  handleReminderJob,
  type ReminderPrismaClient,
  type ReminderWorkerResult,
} from '../reminders/reminder.worker'
import { WhatsAppEscalationNotifier } from '../escalation/escalation.scheduler'
import { handleEscalationTimeout } from '../escalation/timeout.service'
import { createEmergencyFromAnomaly } from '../emergency/emergency.service'

export const SIMULATOR_SCENARIOS = [
  'REMINDER_CONFIRMED',
  'REMINDER_NO_RESPONSE',
  'HEART_RATE_ANOMALY',
  'PROVIDER_FAILURE',
] as const

export type SimulatorScenario = (typeof SIMULATOR_SCENARIOS)[number]

export function isSimulatorScenario(value: string): value is SimulatorScenario {
  return (SIMULATOR_SCENARIOS as readonly string[]).includes(value)
}

/**
 * Default scenario: Pak Haji (Amlodipine 5 mg, keluarga Sari TIER_1) — satu persona
 * sudah menutup skenario A dan B. Default anomali: Bu Ratna (smartwatch aktif).
 */
export const DEMO_SCENARIO_DEFAULTS = {
  scheduleId: DEMO_IDS.scheduleAmlodipinePagi,
  patientId: DEMO_IDS.userBuRatna,
} as const

/** Persona yang boleh disentuh reset. Di luar daftar ini, tidak ada yang dihapus. */
const DEMO_PATIENT_IDS = [DEMO_IDS.userBuRatna, DEMO_IDS.userPakHaji] as const

/**
 * Klien Prisma untuk seluruh query scenario. Default `prisma` global; disuntik di
 * integration test supaya berjalan di DB test dan bukan DB dev.
 */
export type SimulatorClient = typeof prisma

export interface ScenarioOptions {
  client?: SimulatorClient
  scheduleId?: string
  patientId?: string
}

export interface ScenarioOutcome {
  scenario: SimulatorScenario
  /** Apa yang harus dilakukan presenter berikutnya. */
  step: string
  summary: Record<string, unknown>
  /** Resource yang perlu dibuka presenter (untuk menekan tombol di panel). */
  focus: { type: string; id: string } | null
}

function whatsappService() {
  return getWhatsAppService()
}

/** Provider aktif; error jelas kalau bukan mock (demo tidak boleh diam-diam melewati provider sungguhan). */
export function requireMockProvider(): MockWhatsAppProvider {
  const provider = whatsappService().provider
  if (!(provider instanceof MockWhatsAppProvider)) {
    throw notFound('Simulasi WhatsApp hanya tersedia saat PROVIDER_MODE=mock')
  }
  return provider
}

/** Scenario D: aktifkan/matikan kegagalan pengiriman di mock provider. */
export function setProviderFailureSimulation(enabled: boolean, failNext = 99): boolean {
  requireMockProvider().simulateFailures(enabled ? failNext : 0)
  return enabled
}

/** True bila ada pesan mock yang gagal tersimpan — dipakai panel untuk badge status. */
export function hasProviderFailure(): boolean {
  return getWhatsAppSandbox()
    .list({ limit: 20 })
    .some((m) => m.status === 'FAILED')
}

async function resolveScheduleId(client: SimulatorClient, scheduleId?: string): Promise<string> {
  if (!scheduleId) return DEMO_SCENARIO_DEFAULTS.scheduleId

  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true },
  })
  if (!schedule) throw notFound(`Jadwal ${scheduleId} tidak ditemukan`)
  return scheduleId
}

/**
 * Kirim reminder sekarang, melewati scheduler.
 *
 * `dueAt` dihitung ulang tiap pemanggilan karena nilai itu kunci idempotensi reminder
 * worker — memakai `now` yang sama akan menghasilkan DUPLICATE di pemicu kedua.
 */
export async function triggerReminderNow(options: ScenarioOptions = {}): Promise<ReminderWorkerResult> {
  const client = options.client ?? prisma
  const id = await resolveScheduleId(client, options.scheduleId)
  return handleReminderJob(
    { prisma: client as unknown as ReminderPrismaClient, whatsapp: whatsappService() },
    { scheduleId: id, dueAt: new Date().toISOString() },
  )
}

export async function runReminderConfirmedScenario(options: ScenarioOptions = {}): Promise<ScenarioOutcome> {
  const client = options.client ?? prisma
  const id = await resolveScheduleId(client, options.scheduleId)
  const result = await triggerReminderNow({ ...options, scheduleId: id })

  return {
    scenario: 'REMINDER_CONFIRMED',
    step: 'Tekan "Sudah Minum" pada pesan reminder di panel',
    summary: {
      reminderOutcome: result.outcome,
      patientId: result.patientId,
      escalationRunId: result.escalationRunId,
      providerMessageId: result.providerMessageId,
      error: result.error,
    },
    focus: { type: 'schedule', id },
  }
}

/**
 * Scenario B: eskalasi tanpa menunggu 30 menit produksi.
 *
 * `ESCALATION_PATIENT_WAIT_SEC` tidak diubah dan tidak bisa diubah lewat UI — yang
 * dipendekkan hanya kapan presenter menekan "pasien tidak merespons". Timeout job yang
 * masih terjadwal akan melihat status run sudah berubah lalu dilewati (guard
 * `expectedStatus` di timeout.service.ts), jadi tidak ada notifikasi ganda.
 */
export async function runReminderNoResponseScenario(options: ScenarioOptions = {}): Promise<ScenarioOutcome> {
  const client = options.client ?? prisma
  const id = await resolveScheduleId(client, options.scheduleId)

  const run = await client.escalationRun.findFirst({
    where: {
      sourceScheduleId: id,
      status: { in: ['WAITING_PATIENT', 'FAMILY_TIER_1', 'FAMILY_TIER_2', 'NAKES'] },
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, status: true, patientId: true },
  })

  if (!run) {
    throw notFound(
      'Belum ada run eskalasi aktif. Tekan "Trigger reminder" dulu supaya eskalasi dimulai.',
    )
  }

  const result = await handleEscalationTimeout(
    client as any,
    { notifier: new WhatsAppEscalationNotifier() },
    {
      runId: run.id,
      patientId: run.patientId,
      context: 'SCHEDULE',
      expectedStatus: run.status as any,
      scheduledAt: new Date().toISOString(),
    },
  )

  return {
    scenario: 'REMINDER_NO_RESPONSE',
    step: 'Tekan "Saya Tangani" pada pesan alert keluarga di panel',
    summary: {
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      notifiedCount: result.notifiedCount,
      skippedAntiSpam: result.skippedAntiSpam ?? false,
    },
    focus: { type: 'escalation', id: run.id },
  }
}

/** Scenario C: anomali detak jantung → konfirmasi darurat ke pasien. */
export async function runHeartRateAnomalyScenario(options: ScenarioOptions = {}): Promise<ScenarioOutcome> {
  const client = options.client ?? prisma
  const id = options.patientId ?? DEMO_SCENARIO_DEFAULTS.patientId
  const { ANOMALY_HR_MAX } = getEnv()

  const patient = await client.patient.findUnique({
    where: { id },
    select: { id: true, user: { select: { fullName: true } } },
  })
  if (!patient) throw notFound(`Pasien ${id} tidak ditemukan`)

  // Pakai batas sistem, bukan ambang per-pasien: supaya scenario deterministik apa pun
  // yang demo sebelumnya tetapkan untuk pasien ini.
  const hrBpm = ANOMALY_HR_MAX + 25

  const result = await createEmergencyFromAnomaly(
    client as any,
    {
      patientId: id,
      hrBpm,
      triggerType: 'ANOMALY_HR',
      anomalyReason: `Simulasi anomali: ${hrBpm} bpm (batas sistem ${ANOMALY_HR_MAX} bpm)`,
      locationLat: -7.805,
      locationLng: 110.371,
    },
    { whatsAppService: whatsappService() },
  )

  return {
    scenario: 'HEART_RATE_ANOMALY',
    step: 'Tekan "Saya Butuh Bantuan" (atau "Saya Aman") pada pesan konfirmasi di panel',
    summary: {
      patientName: patient.user.fullName,
      hrBpm,
      emergencyId: result.emergencyAlert.id,
      escalationRunId: result.escalationRun?.id ?? null,
      timeoutSec: result.timeoutSec,
    },
    focus: { type: 'emergency', id: result.emergencyAlert.id },
  }
}

/** Scenario D: gagal kirim → badge FAILED di panel, lalu retry setelah dimatikan. */
export async function runProviderFailureScenario(options: ScenarioOptions = {}): Promise<ScenarioOutcome> {
  setProviderFailureSimulation(true)

  try {
    const result = await triggerReminderNow(options)
    return {
      scenario: 'PROVIDER_FAILURE',
      step: 'Klik scenario A untuk mengirim ulang setelah kegagalan dimatikan',
      summary: {
        reminderOutcome: result.outcome,
        sendAttempts: result.sendAttempts,
        error: result.error,
      },
      focus: null,
    }
  } finally {
    setProviderFailureSimulation(false)
  }
}

export interface ResetSummary {
  messagesCleared: number
  dbDeleted: Record<string, number>
}

/**
 * Reset demo sebelum rehearsal.
 *
 * Cakupannya sengaja sempit: hanya baris milik dua persona di atas. Akun, resep,
 * jadwal, dan seluruh data non-demo tidak disentuh.
 */
export async function resetSimulator(client: SimulatorClient = prisma): Promise<ResetSummary> {
  const sandbox = getWhatsAppSandbox()
  const messagesCleared = sandbox.list().length
  sandbox.clear()

  const patientIds = [...DEMO_PATIENT_IDS]

  // Urutan itu wajib, bukan paralel: EscalationRun direferensikan oleh EscalationStep
  // (runId) dan EmergencyAlert (sourceEmergencyId). Menghapus run sebelum keduanya hilang
  // akan ditolak foreign key.
  const statements = [
    client.complianceLog.deleteMany({ where: { patientId: { in: patientIds } } }),
    client.reminderLog.deleteMany({ where: { patientId: { in: patientIds } } }),
    client.escalationStep.deleteMany({ where: { run: { patientId: { in: patientIds } } } }),
    client.escalationRun.deleteMany({ where: { patientId: { in: patientIds } } }),
    client.emergencyAlert.deleteMany({ where: { patientId: { in: patientIds } } }),
// Sisa percakapan mock yang tercatat lewat webhook ikut dibersihkan.
    //
    // Dua cabang: baris yang menempel ke pasien demo, dan baris dedup webhook yang
    // `patientId`-nya NULL. Yang kedua wajib ikut dihapus — kalau tertinggal, reply
    // "sudah diminum" pada sesi berikutnya langsung kena `processed:false` padahal
    // tidak ada yang mengirim apa pun. Baris `patientId IS NULL` hanya bisa dibuat
    // webhook dedup (semua pemanggil lain selalu mengisi `patientId`).
    client.notification.deleteMany({
      where: {
        providerMessageId: { not: null },
        OR: [{ patientId: { in: patientIds } }, { patientId: null }],
      },
    }),
  ]

  // Atomik: scheduler reminder/eskalasi tetap berjalan di belakang, dan preset tidak boleh
  // berakhir dengan setengah state (run terhapus tapi lognya masih ada, atau sebaliknya).
  const [complianceLogs, reminderLogs, escalationSteps, escalationRuns, emergencyAlerts, notifications] =
    typeof client.$transaction === 'function'
      ? await client.$transaction(statements)
      : await Promise.all(statements)

  return {
    messagesCleared,
    dbDeleted: {
      complianceLogs: complianceLogs.count,
      reminderLogs: reminderLogs.count,
      escalationSteps: escalationSteps.count,
      escalationRuns: escalationRuns.count,
      emergencyAlerts: emergencyAlerts.count,
      notifications: notifications.count,
    },
  }
}
