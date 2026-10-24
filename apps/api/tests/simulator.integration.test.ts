// End-to-end alur demo WhatsApp Simulator terhadap DB test.
//
// Ini test yang paling menjagaogi plan: mockup harus menjalankan *flow bisnis yang sama*
// dengan kanal WhatsApp. Kalau reply hanya mengubah tampilan panel tanpa menyentuh
// `compliance_logs` / `escalation_runs` / `emergency_alerts`, test ini gagal — dan demo
// di presentasi jadi tidak berarti apa-apa.
//
// Dilewati otomatis bila TEST_DATABASE_URL tidak diset.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WaButtonIntent, buildButtonId } from '../src/integrations/whatsapp/parser'
import { getWhatsAppSandbox, resetWhatsAppSandbox } from '../src/integrations/whatsapp/sandbox'
import { getWhatsAppService, resetWhatsAppServiceCache } from '../src/integrations/whatsapp/whatsapp.service'
import { dispatchWaIntent } from '../src/modules/wa-intents'
import {
  resetSimulator,
  runHeartRateAnomalyScenario,
  runReminderConfirmedScenario,
  runReminderNoResponseScenario,
  triggerReminderNow,
} from '../src/modules/simulator/scenarios.service'
import { deferMedicationIntake } from '../src/modules/compliance/compliance.service'
import { loadRecipientDirectory, toMessageView, type SimulatorThreadView } from '../src/modules/simulator/sandbox.service'
import { DEMO_IDS, DEMO_PHONES, seedDemoPersonas } from '../prisma/personas'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const PAK_HAJI_PHONE_WA = `62${DEMO_PHONES.pakHaji.slice(1)}`
const SARI_PHONE_WA = `62${DEMO_PHONES.sari.slice(1)}`
const BU_RATNA_PHONE_WA = `62${DEMO_PHONES.buRatna.slice(1)}`
const OUTSIDER_PHONE_WA = '628129999999'

describe.skipIf(!isTestDbConfigured())('End-to-end WhatsApp Simulator', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    migrateTestDb()
    prisma = createTestPrisma()
    // Pastikan mode mock: test ini tidak boleh pernah menyentuh provider sungguhan.
    process.env.PROVIDER_MODE = 'mock'
    resetWhatsAppServiceCache()
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  beforeEach(async () => {
    await resetTestDb(prisma)
    await seedDemoPersonas(prisma)
    resetWhatsAppSandbox()
    resetWhatsAppServiceCache()
  })

  function latestMessageFor(to: string) {
    return getWhatsAppSandbox().list({ to, limit: 1 })[0]
  }

  /** Bentuk yang sama dengan yang dipakai route panel, agar test dan UI tidak berbeda. */
  async function buildThreads(client: PrismaClient): Promise<SimulatorThreadView[]> {
    const sandbox = getWhatsAppSandbox()
    const raw = sandbox.threads()
    const directory = await loadRecipientDirectory(client, raw.map((t) => t.to))

    return raw.map((thread) => ({
      recipient: directory.get(thread.to) ?? {
        phone: thread.to,
        displayPhone: thread.to,
        kind: 'UNKNOWN' as const,
        label: 'Nomor tidak dikenal',
        patientId: null,
      },
      messageCount: thread.messageCount,
      lastMessageAt: thread.lastMessageAt,
      hasUnanswered: thread.hasUnanswered,
    }))
  }

  // ------------------------------------------------------------------ Scenario A

  it('A: reminder terkirim, tombol "Sudah Minum" menulis compliance CONFIRMED & menutup eskalasi', async () => {
    const outcome = await runReminderConfirmedScenario({ client: prisma as any })

    expect(outcome.summary.reminderOutcome).toBe('SENT')
    const reminder = latestMessageFor(PAK_HAJI_PHONE_WA)
    expect(reminder).toBeDefined()
    expect(reminder.body).toContain('Amlodipine')
    expect(reminder.buttons.map((b) => b.id)).toEqual([
      buildButtonId(WaButtonIntent.CONFIRM_TAKEN, DEMO_IDS.scheduleAmlodipinePagi),
      buildButtonId(WaButtonIntent.DEFER, DEMO_IDS.scheduleAmlodipinePagi),
    ])

    const runId = (await prisma.escalationRun.findFirstOrThrow({
      where: { sourceScheduleId: DEMO_IDS.scheduleAmlodipinePagi },
    })).id
    expect(await prisma.escalationRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
      status: 'WAITING_PATIENT',
    })

    const result = await dispatchWaIntent(
      { prisma: prisma as any },
      {
        intent: WaButtonIntent.CONFIRM_TAKEN,
        resourceId: DEMO_IDS.scheduleAmlodipinePagi,
        actorPhone: PAK_HAJI_PHONE_WA,
      },
    )

    expect(result.outcome).toMatch(/^CONFIRMED/)

    const log = await prisma.complianceLog.findFirstOrThrow({
      where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi },
    })
    expect(log.status).toMatch(/^CONFIRMED/)
    expect(log.channel).toBe('WHATSAPP')

    // AC-3.4: konfirmasi sebelum timeout membatalkan eskalasi.
    expect(await prisma.escalationRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
      status: 'RESOLVED',
      resolutionType: 'PATIENT_CONFIRMED',
    })
  })

  it('A: tombol yang sama ditekan dua kali tidak menambah baris kepatuhan', async () => {
    await triggerReminderNow({ client: prisma as any })
    const input = {
      intent: WaButtonIntent.CONFIRM_TAKEN,
      resourceId: DEMO_IDS.scheduleAmlodipinePagi,
      actorPhone: PAK_HAJI_PHONE_WA,
    }

    await dispatchWaIntent({ prisma: prisma as any }, input)
    await expect(dispatchWaIntent({ prisma: prisma as any }, input)).rejects.toMatchObject({
      statusCode: 409,
    })

    expect(await prisma.complianceLog.count({ where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi } })).toBe(1)
  })

  it('A: reply dari nomor yang bukan pemilik jadwal ditolak dan tidak ada state berubah', async () => {
    await triggerReminderNow({ client: prisma as any })

    await expect(
      dispatchWaIntent(
        { prisma: prisma as any },
        {
          intent: WaButtonIntent.CONFIRM_TAKEN,
          resourceId: DEMO_IDS.scheduleAmlodipinePagi,
          actorPhone: OUTSIDER_PHONE_WA,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(await prisma.complianceLog.count()).toBe(0)
  })

  // ------------------------------------------------------------------ DEFER

  it('DEFER: slot dicatat TUNDA, eskalasi tetap berjalan, dan konfirmasi sesudahnya upgrading baris yang sama', async () => {
    await triggerReminderNow({ client: prisma as any })

    const deferred = await deferMedicationIntake(
      prisma as any,
      { scheduleId: DEMO_IDS.scheduleAmlodipinePagi, channel: 'WHATSAPP', minutes: 15 },
      { enqueueReminder: async ({ scheduleId, dueAt }) => `job-${scheduleId}-${dueAt.getTime()}` },
    )

    expect(deferred.minutes).toBe(15)
    expect(deferred.escalationRunId).toBeTruthy()

    const tunda = await prisma.complianceLog.findFirstOrThrow({
      where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi },
    })
    expect(tunda.status).toBe('TUNDA')
    expect(tunda.confirmedAt).toBeNull()

    // Menunda bukan berarti minum: eskalasi tidak boleh ditutup.
    const run = await prisma.escalationRun.findFirstOrThrow({
      where: { sourceScheduleId: DEMO_IDS.scheduleAmlodipinePagi },
    })
    expect(run.status).toBe('WAITING_PATIENT')

    // Pasien berubah pikiran lalu mengonfirmasi: baris yang sama dinaikkan, bukan 409.
    const confirmed = await dispatchWaIntent(
      { prisma: prisma as any },
      {
        intent: WaButtonIntent.CONFIRM_TAKEN,
        resourceId: DEMO_IDS.scheduleAmlodipinePagi,
        actorPhone: PAK_HAJI_PHONE_WA,
      },
    )
    expect(confirmed.outcome).toMatch(/^CONFIRMED/)

    const after = await prisma.complianceLog.findFirstOrThrow({
      where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi },
    })
    expect(after.id).toBe(tunda.id)
    expect(after.status).toMatch(/^CONFIRMED/)
    expect(await prisma.complianceLog.count({ where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi } })).toBe(1)
  })

  it('DEFER diulang tidak menambah reminder susulan kedua', async () => {
    await triggerReminderNow({ client: prisma as any })
    let enqueueCount = 0
    const deps = {
      enqueueReminder: async () => {
        enqueueCount += 1
        return 'job-1'
      },
    }

    const first = await deferMedicationIntake(
      prisma as any,
      { scheduleId: DEMO_IDS.scheduleAmlodipinePagi, channel: 'WHATSAPP' },
      deps,
    )
    const second = await deferMedicationIntake(
      prisma as any,
      { scheduleId: DEMO_IDS.scheduleAmlodipinePagi, channel: 'WHATSAPP' },
      deps,
    )

    expect(first.alreadyDeferred).toBe(false)
    expect(second.alreadyDeferred).toBe(true)
    expect(enqueueCount).toBe(1)
    expect(await prisma.complianceLog.count({ where: { scheduleId: DEMO_IDS.scheduleAmlodipinePagi } })).toBe(1)
  })

  // ------------------------------------------------------------------ Scenario B

  it('B: tidak merespons memindahkan eskalasi ke keluarga, "Saya Tangani" menutupnya', async () => {
    await triggerReminderNow({ client: prisma as any })

    const escalated = await runReminderNoResponseScenario({ client: prisma as any })
    expect(escalated.summary.previousStatus).toBe('WAITING_PATIENT')
    expect(escalated.summary.newStatus).toBe('FAMILY_TIER_1')
    expect(escalated.summary.notifiedCount).toBeGreaterThan(0)

    const familyAlert = latestMessageFor(SARI_PHONE_WA)
    expect(familyAlert).toBeDefined()
    expect(familyAlert.body).toContain('H. Ahmad Subagio')
    expect(familyAlert.buttons.map((b) => b.id)).toContain(
      buildButtonId(WaButtonIntent.HANDLE, escalated.focus!.id),
    )
    // Alert kepatuhan ke keluarga sengaja tanpa tombol 112 — ini "belum minum obat",
    // bukan darurat medis. Tombol 112 muncul di alert nakes/darurat.
    expect(familyAlert.buttons.find((b) => b.id === 'CALL_112')).toBeUndefined()

    const handled = await dispatchWaIntent(
      { prisma: prisma as any },
      {
        intent: WaButtonIntent.HANDLE,
        resourceId: escalated.focus!.id,
        actorPhone: SARI_PHONE_WA,
      },
    )
    expect(handled.outcome).toBe('HANDLED')
    expect(handled.details.actorRole).toBe('FAMILY')

    const run = await prisma.escalationRun.findUniqueOrThrow({ where: { id: escalated.focus!.id } })
    expect(run.status).toBe('HANDLED')
    expect(run.resolutionType).toBe('FAMILY_HANDLED')
  })

  it('B: "Saya Tangani" dari nomor yang bukan kontak pasien ditolak', async () => {
    await triggerReminderNow({ client: prisma as any })
    const escalated = await runReminderNoResponseScenario({ client: prisma as any })

    await expect(
      dispatchWaIntent(
        { prisma: prisma as any },
        { intent: WaButtonIntent.HANDLE, resourceId: escalated.focus!.id, actorPhone: OUTSIDER_PHONE_WA },
      ),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(await prisma.escalationRun.findUniqueOrThrow({ where: { id: escalated.focus!.id } })).toMatchObject({
      status: 'FAMILY_TIER_1',
    })
  })

  // ------------------------------------------------------------------ Scenario C

  it('C: anomali detak jantung membuat emergency, "Saya Butuh Bantuan" melanjutkan eskalasi', async () => {
    const outcome = await runHeartRateAnomalyScenario({ client: prisma as any })

    const confirmPrompt = latestMessageFor(BU_RATNA_PHONE_WA)
    expect(confirmPrompt.buttons.map((b) => b.id)).toEqual([
      buildButtonId(WaButtonIntent.SAFE, outcome.focus!.id),
      buildButtonId(WaButtonIntent.NEED_HELP, outcome.focus!.id),
    ])

    const alert = await prisma.emergencyAlert.findUniqueOrThrow({ where: { id: outcome.focus!.id } })
    expect(alert.status).toBe('PENDING_PATIENT_CONFIRM')

    const result = await dispatchWaIntent(
      { prisma: prisma as any },
      {
        intent: WaButtonIntent.NEED_HELP,
        resourceId: outcome.focus!.id,
        actorPhone: BU_RATNA_PHONE_WA,
      },
    )
    expect(result.outcome).toBe('NEED_HELP')

    const after = await prisma.emergencyAlert.findUniqueOrThrow({ where: { id: outcome.focus!.id } })
    expect(after.status).toBe('ESCALATING')
  })

  it('C: "Saya Aman" menutup emergency tanpa mengirim alert ke keluarga', async () => {
    const outcome = await runHeartRateAnomalyScenario({ client: prisma as any })

    await dispatchWaIntent(
      { prisma: prisma as any },
      { intent: WaButtonIntent.SAFE, resourceId: outcome.focus!.id, actorPhone: BU_RATNA_PHONE_WA },
    )

    const alert = await prisma.emergencyAlert.findUniqueOrThrow({ where: { id: outcome.focus!.id } })
    expect(alert.status).toBe('RESOLVED_SAFE')
    expect(alert.patientConfirmedSafe).toBe(true)

    // Bu Ratna ALONE + NAKES_FIRST, jadi tidak boleh ada pesan ke kontak apa pun.
    const toFamily = getWhatsAppSandbox().list({ to: `62${DEMO_PHONES.ari.slice(1)}` })
    expect(toFamily).toHaveLength(0)
  })

  // ------------------------------------------------------------------ Scenario D

  it('D: kegagalan provider tercatat FAILED lalu retry setelah normal berhasil', async () => {
    const provider = getWhatsAppService().provider as unknown as { simulateFailures(n: number): void }
    provider.simulateFailures(99)

    const failed = await triggerReminderNow({ client: prisma as any })
    expect(failed.outcome).toBe('FAILED')
    expect(failed.sendAttempts).toBeGreaterThan(0)

    const failedMessage = getWhatsAppSandbox()
      .list({ to: PAK_HAJI_PHONE_WA })
      .find((m) => m.status === 'FAILED')
    expect(failedMessage).toBeDefined()

    provider.simulateFailures(0)
    const retried = await triggerReminderNow({ client: prisma as any })
    expect(retried.outcome).toBe('SENT')

    const delivered = getWhatsAppSandbox().list({ to: PAK_HAJI_PHONE_WA })
    expect(delivered.filter((m) => m.status === 'DELIVERED')).toHaveLength(1)
  })

  // ------------------------------------------------------------------ Panel read model

  it('panel membaca percakapan & label penerima dari database', async () => {
    await runReminderConfirmedScenario({ client: prisma as any })

    const threads = await buildThreads(prisma)
    const pakHaji = threads.find((t) => t.recipient.phone === PAK_HAJI_PHONE_WA)
    expect(pakHaji).toBeDefined()
    expect(pakHaji!.recipient.kind).toBe('PATIENT')
    expect(pakHaji!.recipient.label).toBe('H. Ahmad Subagio')
    expect(pakHaji!.hasUnanswered).toBe(true)

    // Tombol pada view: REPLY aktif, URL (tel:112 / peta) tidak bisa ditekan.
    const views = toMessageView(getWhatsAppSandbox().list({ to: PAK_HAJI_PHONE_WA })[0])
    expect(views.actionable).toBe(true)
    expect(views.buttons.every((b) => b.actionable)).toBe(true)
    expect(views.buttons[0].disabledReason).toBeNull()

    await runReminderNoResponseScenario({ client: prisma as any })
    const familyThread = (await buildThreads(prisma)).find(
      (t) => t.recipient.phone === SARI_PHONE_WA,
    )
    expect(familyThread?.recipient.kind).toBe('FAMILY')
    expect(familyThread?.recipient.label).toContain('keluarga')
  })

  it('pesan yang sudah dibalas menonaktifkan tombolnya dan memberi alasan', async () => {
    await runReminderConfirmedScenario({ client: prisma as any })
    const outbound = getWhatsAppSandbox().list({ to: PAK_HAJI_PHONE_WA })[0]

    await dispatchWaIntent(
      { prisma: prisma as any },
      {
        intent: WaButtonIntent.CONFIRM_TAKEN,
        resourceId: DEMO_IDS.scheduleAmlodipinePagi,
        actorPhone: PAK_HAJI_PHONE_WA,
      },
    )

    getWhatsAppSandbox().recordInbound({ to: PAK_HAJI_PHONE_WA, from: PAK_HAJI_PHONE_WA, body: 'Sudah Minum' })
    const inbound = getWhatsAppSandbox().list({ to: PAK_HAJI_PHONE_WA })[0]
    getWhatsAppSandbox().markThreadReadBefore(PAK_HAJI_PHONE_WA, inbound.createdAt, inbound.messageId)

    const afterReply = toMessageView(outbound)
    expect(afterReply.status).toBe('READ')
    expect(afterReply.actionable).toBe(false)
    expect(afterReply.buttons.every((b) => !b.actionable)).toBe(true)
    expect(afterReply.buttons[0].disabledReason).toBe('Sudah dibalas')
  })

  // ------------------------------------------------------------------ Reset

  it('reset menghapus artefak demo tetapi tidak menyentuh data di luar namespace demo', async () => {
    // Pasien ketiga di luar fixture demo: harus selamat dari reset.
    const outsiderId = '00000000-0000-4000-8000-0000000000ff'
    await prisma.user.create({
      data: { id: outsiderId, phone: '081122223333', fullName: 'Pasien Non-Demo', role: 'PATIENT' },
    })
    await prisma.patient.create({ data: { id: outsiderId, districtCode: '3471' } })
    await prisma.complianceLog.create({
      data: {
        patientId: outsiderId,
        scheduleId: DEMO_IDS.scheduleAmlodipinePagi,
        medicationId: DEMO_IDS.medicationAmlodipine,
        scheduledAt: new Date('2026-01-01T00:00:00Z'),
        status: 'CONFIRMED',
      },
    })

    await runReminderConfirmedScenario({ client: prisma as any })
    await runHeartRateAnomalyScenario({ client: prisma as any })
    expect(getWhatsAppSandbox().list().length).toBeGreaterThan(0)

    const summary = await resetSimulator(prisma as any)
    expect(summary.messagesCleared).toBeGreaterThan(0)
    expect(getWhatsAppSandbox().list()).toHaveLength(0)

    expect(await prisma.complianceLog.count({ where: { patientId: DEMO_IDS.userPakHaji } })).toBe(0)
    expect(await prisma.escalationRun.count({ where: { patientId: DEMO_IDS.userPakHaji } })).toBe(0)
    expect(await prisma.emergencyAlert.count({ where: { patientId: DEMO_IDS.userBuRatna } })).toBe(0)

    // Data non-demo & akun/resep tetap utuh.
    expect(await prisma.complianceLog.count({ where: { patientId: outsiderId } })).toBe(1)
    expect(await prisma.user.count()).toBeGreaterThan(1)
    expect(await prisma.medication.count({ where: { id: DEMO_IDS.medicationAmlodipine } })).toBe(1)
    expect(await prisma.schedule.count({ where: { id: DEMO_IDS.scheduleAmlodipinePagi } })).toBe(1)
  })
})