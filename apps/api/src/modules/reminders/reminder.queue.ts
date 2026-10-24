// Queue reminder sebagai singleton modul.
//
// `registerReminderScheduler` (scheduler) dan jalur tunda dari tombol "Tunda" butuh queue
// yang sama: dua instance BullMQ dengan nama queue identik akan membuat dua worker|deliver
// job yang sama dua kali.
import { getWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import { prisma } from '../../lib/prisma'
import type { JobQueue, QueueMode } from '../../lib/queue'
import {
  createReminderJobQueue,
  type ReminderJobPayload,
  type ReminderPrismaClient,
  type ReminderWorkerDeps,
} from './reminder.worker'

let queue: JobQueue<ReminderJobPayload> | undefined

export interface ReminderJobQueueOptions {
  mode?: QueueMode
  deps?: ReminderWorkerDeps
}

/** Queue reminder proses. Dibuat sekali lalu dipakai ulang oleh scheduler & defer. */
export function getReminderJobQueue(options: ReminderJobQueueOptions = {}): JobQueue<ReminderJobPayload> {
  queue ??= createReminderJobQueue(
    options.deps ??
      ({
        prisma: prisma as unknown as ReminderPrismaClient,
        whatsapp: getWhatsAppService(),
      } satisfies ReminderWorkerDeps),
    { mode: options.mode },
  )
  return queue
}

/** Dipakai test & saat proses dimatikan. */
export async function closeReminderJobQueue(): Promise<void> {
  await queue?.close()
  queue = undefined
}