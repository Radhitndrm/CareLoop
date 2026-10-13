'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2Icon, PlusIcon, TriangleAlertIcon } from 'lucide-react'
import { createClinic, getClinics, updateClinic, type Clinic } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Input, Label, NativeSelect } from '@/components/ui/input'
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
import { DataTableShell } from '@/components/data-table'

const TYPE_LABEL: Record<string, string> = {
  PUSKESMAS: 'Puskesmas',
  PUSKESMAS_PEMBANTU: 'Puskesmas Pembantu',
  RUMAH_SAKIT: 'Rumah Sakit',
  KLINIK: 'Klinik',
  APOTEK: 'Apotek',
}

export default function AdminClinicsPage() {
  const { token, user } = useAuth()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      // `includeInactive` supaya administrator tetap bisa melihat dan menghidupkan
      // kembali puskesmas yang dinonaktifkan.
      setClinics(await getClinics({ includeInactive: true }))
      setErrorMessage(null)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar puskesmas')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  // Lihat catatan di halaman /admin/nakes: fetch ditulis inline supaya punya
  // penjaga pembatalan.
  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        // `includeInactive` supaya administrator tetap bisa menghidupkan kembali
        // puskesmas yang dinonaktifkan.
        const result = await getClinics({ includeInactive: true })
        if (!isCancelled) {
          setClinics(result)
          setErrorMessage(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar puskesmas')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [token])

  const toggleActive = async (clinic: Clinic) => {
    try {
      await updateClinic(clinic.id, { isActive: !clinic.isActive })
      await load()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah status puskesmas')
    }
  }

  if (user && user.role !== 'ADMIN') {
    return (
      <Alert variant="warning" icon={<TriangleAlertIcon />}>
        Halaman ini hanya untuk administrator.
      </Alert>
    )
  }

  return (
    <>
      <PageHeader
        title="Data Puskesmas"
        description="Puskesmas yang terdaftar di sini muncul sebagai pilihan di form pendaftaran pasien dan undangan staf."
        actions={
          <Button onClick={() => setIsFormOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Tambah Puskesmas
          </Button>
        }
      />

      <ClinicForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onCreated={() => {
          setIsFormOpen(false)
          void load()
        }}
      />

      {errorMessage ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {errorMessage}
        </Alert>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <DataTableShell
          empty={clinics.length === 0}
          toolbar={
            <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <Building2Icon className="mr-1.5 inline size-3.5" aria-hidden="true" />
              {clinics.length} puskesmas
            </span>
          }
        >
          {clinics.length === 0 ? (
            <EmptyState
              icon={<Building2Icon className="size-5" aria-hidden="true" />}
              title="Belum ada puskesmas"
              description="Tambahkan puskesmas agar operator bisa mendaftarkan pasien dan staf ke wilayah yang benar."
            />
          ) : (
            <div className="data-table-scroll">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3.5">Nama</th>
                    <th className="px-4 py-3.5">Tipe</th>
                    <th className="px-4 py-3.5">Wilayah</th>
                    <th className="px-4 py-3.5">Kontak</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.map((clinic) => (
                    <tr key={clinic.id}>
                      <td className="px-4 py-4 font-medium">{clinic.name}</td>
                      <td className="px-4 py-4">{TYPE_LABEL[clinic.type] ?? clinic.type}</td>
                      <td className="px-4 py-4 font-mono text-muted-foreground">
                        {clinic.districtCode ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{clinic.phone ?? '—'}</td>
                      <td className="px-4 py-4">
                        {clinic.isActive ? (
                          <Badge variant="success">Aktif</Badge>
                        ) : (
                          <Badge variant="neutral">Nonaktif</Badge>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Button size="xs" variant="ghost" onClick={() => void toggleActive(clinic)}>
                          {clinic.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
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

function ClinicForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('PUSKESMAS')
  const [districtCode, setDistrictCode] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (name.trim().length < 3) {
      setError('Nama puskesmas minimal 3 karakter')
      return
    }

    setIsSaving(true)
    try {
      await createClinic({
        name: name.trim(),
        type,
        districtCode: districtCode.trim() || undefined,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
      })
      setName('')
      setDistrictCode('')
      setAddress('')
      setPhone('')
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan puskesmas')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader icon={<Building2Icon className="size-4" />}>
          <SheetTitle>Tambah Puskesmas</SheetTitle>
          <SheetDescription>
            Puskesmas yang dibuat di sini langsung muncul sebagai pilihan di form pasien dan
            undangan staf.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {error ? (
              <Alert variant="danger" icon={<TriangleAlertIcon />}>
                {error}
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="clinic-name">Nama puskesmas</Label>
                <Input id="clinic-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clinic-type">Tipe</Label>
                <NativeSelect id="clinic-type" value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="clinic-district">Kode wilayah</Label>
                <Input
                  id="clinic-district"
                  value={districtCode}
                  onChange={(e) => setDistrictCode(e.target.value)}
                  placeholder="3471"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="clinic-address">Alamat</Label>
                <Input id="clinic-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clinic-phone">Nomor kontak</Label>
                <Input
                  id="clinic-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0274-370478"
                />
              </div>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              Simpan
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}