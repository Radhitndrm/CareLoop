// CL-110: Scheduler timeout eskalasi.
//
// Timeout eskalasi sebelumnya hanya bisa dipicu lewat `POST /internal/jobs/escalation-timeout`
// yang harus dipanggil manual dari luar — tidak ada yang menjadwalkan, dan handler-nya
// selalu memakai `MockEscalationNotifier`, jadi alert keluarga/nakes tidak pernah benar-benar
// terkirim. File ini menutup kedua celah itu:
//
//   1. `WhatsAppEscalationNotifier` mengirim alert lewat WhatsAppService (satu-satunya
//      jalur keluar pesan, AGENTS.md §8).
//   2. `reconcileEscalationTimeouts` memindai setiap run eskalasi yang belum selesai
//      lalu menjadwalkan timeout-nya pada job queue persisten.
//
// Pendekatan reconciler dipilih daripada chaining: satu tick idempoten memastikannya
// setiap run aktif selalu punya timeout yang terjadwal, termasuk run yang timeout-nya
// hilang karena restart, filter, atau kegagalan enqueue sebelumnya. Job id-nya
// deterministik (`runId` + status), jadi tick berulang tidak menumpuk job.
//
// `handleEscalationTimeout` sudah punya jaring pengaman `expectedStatus`: job basi yang
// terlanjur ada di queue saat run sudah berganti tier atau sudah RESOLVED akan diabaikan.
import type { FastifyInstance } from 'fastify'
import { EscalationContext, EscalationRunStatus } from '@careloop/shared'
import { getWhatsAppService, type WhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import { buildFamilyAlertBody, buildNakesAlertBody } from '../../integrations/whatsapp/templates'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { createJobQueue, registerQueueLifecycle, type JobQueue, type QueueMode } from '../../lib/queue'
import type { EscalationPrismaClient } from './escalation.service'
import {
  formatFamilyAlertMessage,
  formatNakesEscalationAlertMessage,
  getTierTimeoutSec,
  handleEscalationTimeout,
  type EscalationNotifier,
  type EscalationTimeoutJobPayload,
  type FamilyAlertMessageInput,
  type NakesAlertMessageInput,
} from './timeout.service'

export const ESCALATION_TIMEOUT_QUEUE_NAME = 'escalation-timeout'
export const ESCALATION_TIMEOUT_RECONCILE_QUEUE_NAME = 'escalation-timeout-reconcile'

export const ESCALATION_RECONCILE_INTERVAL_MS = 60_000

/** Status run yang masih menunggu timeout; run di luar daftar ini tidak dijadwalkan. */
export const ACTIVE_ESCALATION_STATUSES = [
  EscalationRunStatus.WAITING_PATIENT,
  EscalationRunStatus.FAMILY_TIER_1,
  EscalationRunStatus.FAMILY_TIER_2,
  EscalationRunStatus.NAKES,
] as const

/**
 * `messageKey` EscalationStep yang menandai masuknya run ke tier aktif. Dipakai untuk
 * menghitung sejak kapan timeout tier berjalan — `escalation_runs` tidak menyimpan
 * waktu masuk status, jadi timeline step adalah sumber yang sudah ada.
 */
const TIER_ENTRY_STEP_KEY: Partial<Record<string, string>> = {
  [EscalationRunStatus.FAMILY_TIER_1]: 'alert.family.tier_1',
  [EscalationRunStatus.FAMILY_TIER_2]: 'alert.family.tier_2',
  [EscalationRunStatus.NAKES]: 'alert.nakes',
}

/**
 * Notifier produksi: alert keluarga/nakes benar-benar dikirim lewat WhatsAppService.
 *
 * `handleEscalationTimeout` menyerahkan instruksi terformat ke notifier, bukan teks final,
 * jadi penyusunan kalimat tetap dipegang `formatFamilyAlertMessage` /
 * `formatNakesEscalationAlertMessage` agar isi pesan mock dan produksi tidak berbeda.
 */
export class WhatsAppEscalationNotifier implements EscalationNotifier {
  constructor(private readonly whatsapp: WhatsAppService = getWhatsAppService()) {}

  async sendFamilyAlert(input: FamilyAlertMessageInput): Promise<{ providerMessageId: string | null }> {
    const { body, instructions } = formatFamilyAlertMessage({
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      medicationName: input.medicationName,
      scheduledTime: input.scheduledTime,
    })
    // Interaktif, bukan teks: tanpa tombol "Saya Tangani" keluarga tidak punya cara
    // menutup eskalasi dari WhatsApp (AC-7.x) dan dispatcher HANDLE jadi tak terjangkau.
    const result = await this.whatsapp.sendInteractive(
      input.contactPhone,
      buildFamilyAlertBody(
        {
          patientName: input.patientName,
          context: body,
          instruction: instructions,
          showCall112: false,
        },
        input.runId,
      ),
    )
    return { providerMessageId: result.providerMessageId }
  }

  async sendNakesAlert(input: NakesAlertMessageInput): Promise<{ providerMessageId: string | null }> {
    const { body, instructions } = formatNakesEscalationAlertMessage({
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      medicationName: input.medicationName,
      scheduledTime: input.scheduledTime,
    })
    const result = await this.whatsapp.sendInteractive(
      input.contactPhone,
      buildNakesAlertBody(
        {
          patientName: input.patientName,
          context: body,
          instruction: instructions,
          showCall112: true,
        },
        input.runId,
      ),
    )
    return { providerMessageId: result.providerMessageId }
  }
}

/**
 * Pemisah memakai `-`, bukan `:` — BullMQ menolak `:` pada custom jobId. Perhatikan ini
 * hanya berlaku di mode bullmq; in-process tidak memvalidasi jobId.
 */
export function escalationTimeoutJobId(runId: string, status: string): string {
  return `${ESCALATION_TIMEOUT_QUEUE_NAME}-${runId}-${status}`
}

interface EscalationRunRow {
  id: string
  patientId: string
  status: string
  context: EscalationContext
  createdAt: Date
  configSnapshot: unknown
  steps: Array<{ messageKey: string | null; sentAt: Date | null }>
}

/**
 * Kapan timeout tier berjalan dihitung dari waktu masuk run ke status tersebut:
 * `WAITING_PATIENT` memakai `createdAt`, tier berikutnya memakai `sentAt` langkah
 * alert yang memicunya. Bila langkah tidak ditemukan (mis. hanya sebagian kontak
 * keluarga yang menerima alert), jatuh kembali ke `createdAt` agar timeout tetap
 * terjadwal — lebih baik terlalu cepat daripada eskalasi yang tidak pernah jalan.
 */
export function escalationDeadlineAt(run: EscalationRunRow): Date | null {
  const durationMs =
    getTierTimeoutSec(
      run.status as EscalationRunStatus,
      run.context,
      (run.configSnapshot ?? null) as Record<string, unknown> | null,
    ) * 1000

  const entryKey = TIER_ENTRY_STEP_KEY[run.status]
  const entryStep = entryKey ? run.steps.find((step) => step.messageKey === entryKey) : undefined
  const enteredAt = entryStep?.sentAt ?? run.createdAt

  return new Date(enteredAt.getTime() + durationMs)
}

/**
 * Bentuk client yang dipakai reconciler. `findMany` di `EscalationPrismaClient` opsional
 * karena transisi state machine tidak butuh memindai; reconciler mewajibkannya.
 */
export type EscalationTimeoutClient = EscalationPrismaClient & {
  escalationRun: {
    findMany(args: any): Promise<any>
  }
}

export interface ReconcileEscalationTimeoutsResult {
  scanned: number
  scheduled: number
  overdue: number
  failed: number
}

export interface ReconcileEscalationTimeoutsOptions {
  now?: Date
  logger?: { error(obj: unknown, msg: string): void }
}

/**
 * Pastikan setiap run eskalasi aktif punya timeout yang terjadwal. Dipanggil dari tick
 * berkala; aman dipanggil berulang karena `jobId` deterministik.
 */
export async function reconcileEscalationTimeouts(
  client: EscalationTimeoutClient,
  queue: JobQueue<EscalationTimeoutJobPayload>,
  options: ReconcileEscalationTimeoutsOptions = {},
): Promise<ReconcileEscalationTimeoutsResult> {
  const now = options.now ?? new Date()

  const runs = (await client.escalationRun.findMany({
    where: { status: { in: [...ACTIVE_ESCALATION_STATUSES] } },
    select: {
      id: true,
      patientId: true,
      status: true,
      context: true,
      createdAt: true,
      configSnapshot: true,
      steps: { select: { messageKey: true, sentAt: true } },
    },
  })) as unknown as EscalationRunRow[]

  const result: ReconcileEscalationTimeoutsResult = {
    scanned: runs.length,
    scheduled: 0,
    overdue: 0,
    failed: 0,
  }

  for (const run of runs) {
    const deadline = escalationDeadlineAt(run)
    if (!deadline) continue

    const delayMs = deadline.getTime() - now.getTime()
    if (delayMs <= 0) result.overdue += 1

    try {
      await queue.schedule(
        {
          runId: run.id,
          patientId: run.patientId,
          context: run.context as EscalationTimeoutJobPayload['context'],
          expectedStatus: run.status as EscalationRunStatus,
          scheduledAt: deadline.toISOString(),
        },
        Math.max(0, delayMs),
        { jobId: escalationTimeoutJobId(run.id, run.status) },
      )
      result.scheduled += 1
    } catch (error) {
      result.failed += 1
      options.logger?.error({ err: error, runId: run.id }, 'gagal menjadwalkan timeout eskalasi')
    }
  }

  return result
}

export interface EscalationTimeoutWorkerDeps {
  client: EscalationTimeoutClient
  notifier: EscalationNotifier
}

export async function handleEscalationTimeoutJob(
  deps: EscalationTimeoutWorkerDeps,
  payload: EscalationTimeoutJobPayload,
): Promise<void> {
  await handleEscalationTimeout(deps.client, { notifier: deps.notifier }, payload)
}

export function createEscalationTimeoutQueue(
  deps: EscalationTimeoutWorkerDeps,
  options: { mode?: QueueMode } = {},
): JobQueue<EscalationTimeoutJobPayload> {
  return createJobQueue<EscalationTimeoutJobPayload>({
    name: ESCALATION_TIMEOUT_QUEUE_NAME,
    mode: options.mode,
    defaultAttempts: 1,
    handler: async (payload) => {
      await handleEscalationTimeoutJob(deps, payload)
    },
  })
}

export interface EscalationReconcileJobPayload {
  tickAt: string
}

export interface EscalationReconcileOptions {
  mode?: QueueMode
  client?: EscalationTimeoutClient
  timeoutQueue: JobQueue<EscalationTimeoutJobPayload>
  now?: () => Date
  intervalMs?: number
}

export function createEscalationReconcileQueue(
  options: EscalationReconcileOptions,
): JobQueue<EscalationReconcileJobPayload> {
  const intervalMs = options.intervalMs ?? ESCALATION_RECONCILE_INTERVAL_MS
  const now = options.now ?? (() => new Date())

  const queue = createJobQueue<EscalationReconcileJobPayload>({
    name: ESCALATION_TIMEOUT_RECONCILE_QUEUE_NAME,
    mode: options.mode,
    defaultAttempts: 1,
    handler: async (payload) => {
      const client = options.client ?? (prisma as unknown as EscalationTimeoutClient)
      const result = await reconcileEscalationTimeouts(client, options.timeoutQueue, {
        now: now(),
        logger: { error: (obj, msg) => console.error(msg, obj) },
      })
      // eslint-disable-next-line no-console -- ringkasan tick untuk log server
      console.log(
        `[escalation-reconcile] ${payload.tickAt}: ${result.scheduled} timeout dijadwalkan (${result.overdue} sudah jatuh tempo), ${result.failed} gagal`,
      )
      scheduleNextReconcileTick(queue, intervalMs, now())
    },
  })

  return queue
}

/** Antrean reconciler self-perpanjang, sama seperti dispatcher reminder. */
export function scheduleNextReconcileTick(
  queue: JobQueue<EscalationReconcileJobPayload>,
  intervalMs: number,
  now: Date = new Date(),
): void {
  const nextAt = now.getTime() + intervalMs
  void queue.schedule(
    { tickAt: new Date(nextAt).toISOString() },
    intervalMs,
    { jobId: `${ESCALATION_TIMEOUT_RECONCILE_QUEUE_NAME}-${nextAt}` },
  )
}

export function registerEscalationScheduler(app: FastifyInstance, mode?: QueueMode): void {
  const workerDeps: EscalationTimeoutWorkerDeps = {
    client: prisma as unknown as EscalationTimeoutClient,
    notifier: new WhatsAppEscalationNotifier(),
  }

  const timeoutQueue = createEscalationTimeoutQueue(workerDeps, { mode })
  const reconcileQueue = createEscalationReconcileQueue({ mode, timeoutQueue })

  registerQueueLifecycle(app, [
    timeoutQueue as unknown as JobQueue<unknown>,
    reconcileQueue as unknown as JobQueue<unknown>,
  ])

  app.addHook('onReady', async () => {
    void reconcileQueue.enqueue({ tickAt: new Date().toISOString() })
    app.log.info(
      { queues: [timeoutQueue.name, reconcileQueue.name] },
      'scheduler timeout eskalasi aktif',
    )
  })

  getEnv()
}