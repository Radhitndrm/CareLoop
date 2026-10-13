'use client'

import { use, useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CheckCheckIcon,
  HeartPulseIcon,
  PillIcon,
  PlusIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'
import {
  approveMedication,
  getCompliance,
  getMedications,
  getPatient,
  setHrThresholds,
  draftMedication,
  addSchedule,
  type ComplianceItem,
  type Medication,
  type PatientDetail,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { NAKES_ROLE_LABEL } from '@/lib/nakes-role'
import { PageHeader } from '@/components/page-header'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard, type StatCardTone } from '@/components/stat-card'
import { CareTeamOnly } from '@/components/auth/care-team-only'
import { ActivationPanel } from '@/components/patients/activation-panel'
import { FamilyContactsPanel } from '@/components/patients/family-contacts-panel'

const MEDICATION_STATUS: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  DRAFT: { label: 'Menunggu validasi dokter', variant: 'warning' },
  APPROVED: { label: 'Aktif', variant: 'success' },
  REJECTED: { label: 'Ditolak dokter', variant: 'destructive' },
}

const COMPLIANCE_STATUS: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  CONFIRMED: { label: 'Sudah diminum', variant: 'success' },
  CONFIRMED_LATE: { label: 'Diminum terlambat', variant: 'warning' },
  MISSED: { label: 'Terlewat', variant: 'destructive' },
  PENDING: { label: 'Menunggu', variant: 'neutral' },
  TUNDA: { label: 'Ditunda', variant: 'info' },
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <CareTeamOnly>
      <PatientDetailContent params={params} />
    </CareTeamOnly>
  )
}

function PatientDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { token, user } = useAuth()

  const [patient, setPatient] = useState<PatientDetail | null>(null)
  const [medications, setMedications] = useState<Medication[]>([])
  const [compliance, setCompliance] = useState<ComplianceItem[]>([])
  const [summary, setSummary] = useState({
    confirmed: 0,
    confirmedLate: 0,
    missed: 0,
    pending: 0,
    adherenceRate: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Perawat/bidan tidak boleh menyetujui resep. Tombol disembunyikan, dan
  // server tetap menolak dengan 403 bila dipaksa — ini hanya tampilan UI.
  const canPrescribe =
    user?.role === 'ADMIN' || user?.nakesRole === 'DOKTER' || user?.nakesRole === 'BIDAN'

  const load = useCallback(async () => {
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const [detail, meds, complianceResult] = await Promise.all([
        getPatient(id),
        getMedications(id),
        getCompliance(id, { limit: 30 }),
      ])
      setPatient(detail)
      setMedications(meds)
      setCompliance(complianceResult.items)
      setSummary(complianceResult.summary)
      setErrorMessage(null)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat data pasien')
    } finally {
      setIsLoading(false)
    }
  }, [id, token])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const [detail, meds, complianceResult] = await Promise.all([
          getPatient(id),
          getMedications(id),
          getCompliance(id, { limit: 30 }),
        ])
        if (!isCancelled) {
          setPatient(detail)
          setMedications(meds)
          setCompliance(complianceResult.items)
          setSummary(complianceResult.summary)
          setErrorMessage(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat data pasien')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [id, token])

  const handleDecision = async (medicationId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActionError(null)
    setBusyId(medicationId)
    try {
      await approveMedication(medicationId, decision)
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses persetujuan')
    } finally {
      setBusyId(null)
    }
  }

  const handleThresholds = async (min: string, max: string) => {
    setActionError(null)
    setBusyId('hr')
    try {
      await setHrThresholds(id, {
        hrMinBpm: min.trim() === '' ? null : Number(min),
        hrMaxBpm: max.trim() === '' ? null : Number(max),
      })
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan ambang')
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-7">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (errorMessage || !patient) {
    return (
      <Alert variant="danger" icon={<TriangleAlertIcon />}>
        <p>{errorMessage}</p>
        <Link
          href="/patients"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-2"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          Kembali ke daftar pasien
        </Link>
      </Alert>
    )
  }

  const adherencePercent = Math.round(summary.adherenceRate * 100)

  return (
    <>
      <PageHeader
        kicker="Data Pasien"
        title={patient.fullName}
        description={`${patient.phone} · ${patient.districtCode ?? 'Tanpa wilayah'}`}
        actions={
          <Badge variant={patient.riskLevel === 'HIGH' ? 'destructive' : 'warning'}>
            Risiko {patient.riskLevel ?? 'LOW'}
          </Badge>
        }
      />

      {actionError ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {actionError}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Tepat waktu"
          value={summary.confirmed}
          tone="success"
          icon={<CheckCheckIcon className="size-5" aria-hidden="true" />}
        />
        <StatCard
          title="Diminum terlambat"
          value={summary.confirmedLate}
          tone="warning"
          icon={<CalendarClockIcon className="size-5" aria-hidden="true" />}
        />
        <StatCard
          title="Terlewat"
          value={summary.missed}
          tone={summary.missed > 0 ? 'danger' : 'muted'}
          icon={<TriangleAlertIcon className="size-5" aria-hidden="true" />}
        />
        <StatCard
          title="Tingkat kepatuhan"
          value={`${adherencePercent}%`}
          tone={
            (adherencePercent >= 80 ? 'success' : adherencePercent >= 50 ? 'warning' : 'danger') as StatCardTone
          }
          icon={<HeartPulseIcon className="size-5" aria-hidden="true" />}
          hint={`${summary.pending} masih menunggu`}
        />
      </div>

      <Tabs defaultValue="medications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="medications">
            <PillIcon aria-hidden="true" />
            Obat &amp; Jadwal
          </TabsTrigger>
          <TabsTrigger value="compliance">
            <CheckCheckIcon aria-hidden="true" />
            Riwayat Kepatuhan
          </TabsTrigger>
          <TabsTrigger value="vitals">
            <HeartPulseIcon aria-hidden="true" />
            Ambang Detak Jantung
          </TabsTrigger>
          <TabsTrigger value="profile">
            <UserRoundIcon aria-hidden="true" />
            Profil
          </TabsTrigger>
          <TabsTrigger value="onboarding">
            <ShieldCheckIcon aria-hidden="true" />
            Onboarding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding" className="space-y-4">
          {/* Checklist aktivasi ditampilkan di atas kontak keluarga karena urutan
              pengerjaannya begitu: data dulu, keluarga, baru checklist bisa terpenuhi. */}
          <ActivationPanel
            patientId={id}
            status={patient.status}
            onActivated={load}
          />
          <FamilyContactsPanel patientId={id} />
        </TabsContent>

        <TabsContent value="medications" className="space-y-4">
          <Card data-reveal className="reveal">
            <CardHeader className="border-b border-border">
              <CardTitle>Resep &amp; Jadwal Minum Obat</CardTitle>
              <CardDescription>
                Resep berstatus draft belum berjalan — pasien tidak menerima pengingat sampai
                disetujui dokter atau bidan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DraftMedicationForm patientId={id} onCreated={load} />

              {medications.length === 0 ? (
                <EmptyState
                  icon={<PillIcon className="size-5" aria-hidden="true" />}
                  title="Belum ada resep"
                  description="Tambahkan obat sebagai draft, lalu minta dokter memvalidasinya."
                />
              ) : (
                <ul className="space-y-4">
                  {medications.map((medication) => {
                    const status = MEDICATION_STATUS[medication.status] ?? MEDICATION_STATUS.DRAFT
                    return (
                      <li key={medication.id} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{medication.name}</h3>
                              <Badge variant={status.variant}>{status.label}</Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {medication.dosage ?? 'Dosis tidak dicatat'} · Mulai {medication.startedAt}
                              {medication.approvedAt
                                ? ` · Disetujui oleh ${medication.approvedByName ?? 'dokter'}`
                                : ''}
                            </p>
                          </div>

                          {medication.status === 'DRAFT' && canPrescribe ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={busyId === medication.id}
                                onClick={() => handleDecision(medication.id, 'APPROVED')}
                              >
                                Setujui
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busyId === medication.id}
                                onClick={() => handleDecision(medication.id, 'REJECTED')}
                              >
                                Tolak
                              </Button>
                            </div>
                          ) : medication.status === 'DRAFT' ? (
                            <span className="text-xs text-muted-foreground">Menunggu dokter / bidan</span>
                          ) : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {medication.schedules.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Belum ada jadwal</span>
                          ) : (
                            medication.schedules.map((schedule) => (
                              <Badge key={schedule.id} variant="secondary" className="h-auto py-1.5">
                                <span>
                                  {schedule.timeOfDay} · {schedule.doseQty}
                                </span>
                                <span className="ml-1 font-normal text-muted-foreground">
                                  {schedule.nextFireAt
                                    ? `→ ${formatDateTime(schedule.nextFireAt)}`
                                    : '(belum aktif)'}
                                </span>
                              </Badge>
                            ))
                          )}
                        </div>

                        {medication.status !== 'REJECTED' ? (
                          <AddScheduleForm
                            patientId={id}
                            medicationId={medication.id}
                            onCreated={load}
                          />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance">
          <Card data-reveal className="reveal">
            <CardHeader>
              <CardTitle>Riwayat Kepatuhan</CardTitle>
              <CardDescription>
                Setiap kali pasien menekan &quot;sudah minum&quot; lewat WhatsApp atau aplikasi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {compliance.length === 0 ? (
                <EmptyState
                  title="Belum ada konfirmasi"
                  description="Belum ada catatan obat yang diminum pasien untuk jadwal ini."
                />
              ) : (
                <div className="data-table-scroll rounded-xl border border-border">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr>
                        <th className="px-4 py-3.5">Jadwal</th>
                        <th className="px-4 py-3.5">Obat</th>
                        <th className="px-4 py-3.5">Status</th>
                        <th className="px-4 py-3.5">Konfirmasi</th>
                        <th className="px-4 py-3.5">Saluran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compliance.map((item) => {
                        const status = COMPLIANCE_STATUS[item.status] ?? COMPLIANCE_STATUS.PENDING
                        return (
                          <tr key={item.id}>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {formatDateTime(item.scheduledAt)}
                            </td>
                            <td className="px-4 py-3.5">
                              {item.medicationName}
                              <span className="ml-1 text-xs text-muted-foreground">{item.doseQty}</span>
                            </td>
                            <td className="px-4 py-3.5">
                              <Badge variant={status.variant}>{status.label}</Badge>
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {item.confirmedAt ? formatDateTime(item.confirmedAt) : '—'}
                            </td>
                            <td className="px-4 py-3.5 text-xs tracking-wide text-muted-foreground uppercase">
                              {item.channel}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vitals">
          <HrThresholdCard
            patient={patient}
            canPrescribe={canPrescribe}
            isSaving={busyId === 'hr'}
            onSave={handleThresholds}
          />
        </TabsContent>

        <TabsContent value="profile" className="grid gap-6 lg:grid-cols-2">
          <Card data-reveal className="reveal">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundIcon className="size-4 text-primary" aria-hidden="true" />
                Profil Pasien
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <InfoRow label="Alamat" value={patient.address ?? '—'} />
                <InfoRow label="Jenis kelamin" value={patient.gender ?? '—'} />
                <InfoRow label="Tanggal lahir" value={patient.dateOfBirth ?? '—'} />
                <InfoRow label="Situasi tinggal" value={patient.livingSituation} />
                <InfoRow
                  label="Preferensi darurat"
                  value={
                    patient.emergencyPreference === 'NAKES_FIRST'
                      ? 'Nakes lebih dulu'
                      : 'Keluarga lebih dulu'
                  }
                />
                <InfoRow
                  label="Smartwatch"
                  value={patient.smartwatchEnabled ? 'Aktif' : 'Tidak aktif'}
                />
                <InfoRow
                  label="Riwayat penyakit"
                  value={patient.healthConditions.join(', ') || '—'}
                />
              </dl>
            </CardContent>
          </Card>

          <Card data-reveal className="reveal" style={{ '--reveal-index': 1 } as CSSProperties}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StethoscopeIcon className="size-4 text-primary" aria-hidden="true" />
                Nakes Penanggung Jawab
              </CardTitle>
            </CardHeader>
            <CardContent>
              {patient.nakesContacts.length === 0 ? (
                <EmptyState
                  icon={<UsersIcon className="size-5" aria-hidden="true" />}
                  title="Belum ada nakes"
                  description="Belum ada nakes yang ditugaskan."
                />
              ) : (
                <ul className="space-y-3">
                  {patient.nakesContacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{contact.nakesName}</p>
                        <p className="text-xs text-muted-foreground">
                          {NAKES_ROLE_LABEL[contact.nakesRole] ?? contact.nakesRole}
                          {contact.isPrimary ? ' · utama' : ''}
                        </p>
                      </div>
                      {contact.isActive ? <Badge variant="success">Aktif</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}

function HrThresholdCard({
  patient,
  canPrescribe,
  isSaving,
  onSave,
}: {
  patient: PatientDetail
  canPrescribe: boolean
  isSaving: boolean
  onSave: (min: string, max: string) => void
}) {
  const [min, setMin] = useState(patient.hrMinBpm?.toString() ?? '')
  const [max, setMax] = useState(patient.hrMaxBpm?.toString() ?? '')

  return (
    <Card data-reveal className="reveal max-w-2xl">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <HeartPulseIcon className="size-4 text-primary" aria-hidden="true" />
          Ambang Deteksi Detak Jantung
        </CardTitle>
        <CardDescription>
          Kosongkan berarti memakai ambang default sistem (50–120 bpm). Nilai ditetapkan dokter atau
          bidan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canPrescribe ? <Badge variant="neutral">Hanya dapat dilihat</Badge> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hr-min">Ambang bawah (bpm)</Label>
            <Input
              id="hr-min"
              type="number"
              value={min}
              disabled={!canPrescribe}
              onChange={(e) => setMin(e.target.value)}
              placeholder="50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hr-max">Ambang atas (bpm)</Label>
            <Input
              id="hr-max"
              type="number"
              value={max}
              disabled={!canPrescribe}
              onChange={(e) => setMax(e.target.value)}
              placeholder="120"
            />
          </div>
        </div>

        {canPrescribe ? (
          <Button onClick={() => onSave(min, max)} disabled={isSaving}>
            {isSaving ? 'Menyimpan…' : 'Simpan Ambang'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function DraftMedicationForm({ patientId, onCreated }: { patientId: string; onCreated: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [dosage, setDosage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) return
    setIsSaving(true)
    setError(null)
    try {
      await draftMedication(patientId, {
        name: name.trim(),
        dosage: dosage.trim() || undefined,
        startedAt: new Date().toISOString().slice(0, 10),
      })
      setName('')
      setDosage('')
      setIsOpen(false)
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan draft resep')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        <PlusIcon aria-hidden="true" />
        Tambah obat sebagai draft
      </Button>

      <SheetContent>
        <SheetHeader icon={<PillIcon className="size-4" />}>
          <SheetTitle>Tambah obat sebagai draft</SheetTitle>
          <SheetDescription>
            Draft belum berjalan sebagai pengingat sampai disetujui dokter atau bidan.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetBody className="space-y-4">
            {error ? (
              <Alert variant="danger" icon={<TriangleAlertIcon />}>
                {error}
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="med-name">Nama obat</Label>
              <Input
                id="med-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Metformin 500 mg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="med-dosage">Dosis</Label>
              <Input
                id="med-dosage"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="500 mg"
              />
            </div>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Menyimpan…' : 'Simpan draft'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function AddScheduleForm({
  patientId,
  medicationId,
  onCreated,
}: {
  patientId: string
  medicationId: string
  onCreated: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState('08:00')
  const [doseQty, setDoseQty] = useState('1 tablet')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await addSchedule(patientId, {
        medicationId,
        timeOfDay,
        doseQty,
        startDate: new Date().toISOString().slice(0, 10),
      })
      setIsOpen(false)
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan jadwal')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <Button variant="ghost" size="xs" className="mt-3" onClick={() => setIsOpen(true)}>
        <PlusIcon aria-hidden="true" />
        Tambah jadwal
      </Button>

      <SheetContent className="w-[min(92vw,26rem)]">
        <SheetHeader icon={<CalendarClockIcon className="size-4" />}>
          <SheetTitle>Tambah jadwal minum obat</SheetTitle>
          <SheetDescription>
            Jadwal baru akan masuk ke pengingat WhatsApp setelah resep disetujui.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetBody className="space-y-4">
            {error ? (
              <Alert variant="danger" icon={<TriangleAlertIcon />}>
                {error}
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sched-time">Jam</Label>
                <Input
                  id="sched-time"
                  type="time"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sched-dose">Dosis</Label>
                <Input
                  id="sched-dose"
                  value={doseQty}
                  onChange={(e) => setDoseQty(e.target.value)}
                />
              </div>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}