'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { SearchIcon, TriangleAlertIcon, UserPlusIcon, UsersIcon } from 'lucide-react'
import { getPatients, type PatientStatus, type PatientSummary } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTableShell } from '@/components/data-table'
import { CareTeamOnly } from '@/components/auth/care-team-only'
import { OnboardingWizard } from '@/components/patients/onboarding-wizard'

const LIVING_OPTIONS = [
  { value: 'ALONE', label: 'Tinggal sendiri' },
  { value: 'WITH_FAMILY', label: 'Tinggal bersama keluarga' },
  { value: 'FAR_FROM_FAMILY', label: 'Jauh dari keluarga' },
  { value: 'OTHER', label: 'Lainnya' },
]

function livingLabel(value: string): string {
  return LIVING_OPTIONS.find((o) => o.value === value)?.label ?? value
}

const STATUS_LABEL: Record<PatientStatus, string> = {
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Aktif',
  INACTIVE: 'Ditangguhkan',
  BLOCKED: 'Diblokir',
}

function statusBadgeVariant(status: PatientStatus) {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'ONBOARDING') return 'warning' as const
  return 'neutral' as const
}

function riskBadgeVariant(level?: string) {
  if (level === 'HIGH') return 'destructive' as const
  if (level === 'MEDIUM') return 'warning' as const
  return 'success' as const
}

export default function PatientsPage() {
  return (
    <CareTeamOnly>
      <PatientsContent />
    </CareTeamOnly>
  )
}

function PatientsContent() {
  const { token, isAuthenticated } = useAuth()
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const result = await getPatients({ search: search || undefined })
      setPatients(result.items)
      setErrorMessage(null)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar pasien')
    } finally {
      setIsLoading(false)
    }
  }, [token, search])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const result = await getPatients({ search: search || undefined })
        if (!isCancelled) {
          setPatients(result.items)
          setErrorMessage(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar pasien')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [token, search])

  return (
    <>
      <PageHeader
        title="Data Pasien"
        description="Pasien dalam wilayah penugasan Anda. Daftar di sini juga menentukan siapa dapat melihat pasien tersebut."
        actions={
          <Button onClick={() => setIsFormOpen(true)}>
            <UserPlusIcon aria-hidden="true" />
            Daftarkan Pasien
          </Button>
        }
      />

      <PatientForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onCreated={() => {
          setIsFormOpen(false)
          void load()
        }}
      />

      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau nomor HP pasien…"
          className="pl-10"
          aria-label="Cari pasien"
        />
      </div>
      {errorMessage ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {errorMessage}
        </Alert>
      ) : null}

      {!isAuthenticated ? (
        <Alert variant="warning" icon={<TriangleAlertIcon />}>
          Masuk terlebih dahulu untuk melihat data pasien.{' '}
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Masuk
          </Link>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <DataTableShell
          empty={patients.length === 0}
          toolbar={
            <>
              <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                <UsersIcon className="mr-1.5 inline size-3.5" aria-hidden="true" />
                {patients.length} pasien terdata
              </span>
            </>
          }
        >
          {patients.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-5" aria-hidden="true" />}
              title="Belum ada pasien"
              description="Belum ada pasien dalam scope Anda. Gunakan tombol Daftarkan Pasien untuk menambahkan."
            />
          ) : (
            <div className="data-table-scroll">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3.5">Pasien</th>
                    <th className="px-4 py-3.5">Wilayah</th>
                    <th className="px-4 py-3.5">Situasi Tinggal</th>
                    <th className="px-4 py-3.5">Kondisi</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Risiko</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr key={patient.id}>
                      <td className="px-4 py-4">
                        <Link
                          href={`/patients/${patient.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {patient.fullName}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">{patient.phone}</p>
                      </td>
                      <td className="px-4 py-4">
                        {patient.districtCode ? (
                          <Badge variant="neutral" className="font-mono">
                            {patient.districtCode}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{livingLabel(patient.livingSituation)}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          {patient.healthConditions.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            patient.healthConditions.map((condition) => (
                              <Badge key={condition} variant="info">
                                {condition}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={statusBadgeVariant(patient.status)}>
                          {STATUS_LABEL[patient.status] ?? patient.status}
                        </Badge>
                        {patient.primaryPuskesmasName ? null : (
                          <p className="mt-1 text-xs text-muted-foreground">Tanpa puskesmas</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {patient.riskLevel ? (
                          <Badge variant={riskBadgeVariant(patient.riskLevel)}>{patient.riskLevel}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataTableShell>
      )}
    </>
  )
}
function PatientForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(96vw,56rem)]">
        <SheetHeader icon={<UserPlusIcon className="size-4" />}>
          <SheetTitle>Pendaftaran Pasien Baru</SheetTitle>
          <SheetDescription>
            Data disimpan sebagai onboarding. Pengingat obat baru berjalan setelah resep
            disetujui dokter dan pasien diaktifkan.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          <OnboardingWizard
            onDone={() => {
              onOpenChange(false)
              onCreated()
            }}
            onCancel={() => onOpenChange(false)}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
