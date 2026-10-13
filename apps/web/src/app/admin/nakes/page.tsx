'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRoundIcon, MapPinIcon, StethoscopeIcon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react'
import {
  addNakesAssignment,
  endNakesAssignment,
  getClinics,
  getNakesAccounts,
  inviteNakesAccount,
  regenerateActivationCode,
  updateNakesAccount,
  type Clinic,
  type NakesAccount,
  type StaffStatus,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
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

const ROLE_LABEL: Record<string, string> = {
  DOKTER: 'Dokter',
  PERAWAT: 'Perawat',
  BIDAN: 'Bidan',
  KADER: 'Kader',
  FARMASI: 'Farmasi',
  LAINNYA: 'Lainnya',
}

const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  INVITED: 'Menunggu aktivasi',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
  DEACTIVATED: 'Berhenti',
}

function StatusBadge({ status }: { status: StaffStatus }) {
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'INVITED'
        ? 'warning'
        : status === 'SUSPENDED'
          ? 'destructive'
          : 'neutral'
  return <Badge variant={variant}>{STAFF_STATUS_LABEL[status]}</Badge>
}

export default function AdminNakesPage() {
  const { token, user } = useAuth()
  const [accounts, setAccounts] = useState<NakesAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      setAccounts(await getNakesAccounts())
      setErrorMessage(null)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar nakes')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  // Fetch di dalam effect (bukan memanggil `load`) supaya pemuatan awal punya
  // penjaga pembatalan; `load` dipakai ulang setelah mutasi.
  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const result = await getNakesAccounts()
        if (!isCancelled) {
          setAccounts(result)
          setErrorMessage(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat daftar nakes')
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

  const changeStatus = async (account: NakesAccount, staffStatus: StaffStatus) => {
    try {
      await updateNakesAccount(account.id, { staffStatus })
      await load()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah status staf')
    }
  }

  const closeAssignment = async (account: NakesAccount, assignmentId: string) => {
    try {
      await endNakesAssignment(account.id, assignmentId)
      await load()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menutup penugasan')
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
        title="Kelola Akun Nakes"
        description="Peran klinis di sini menentukan siapa yang boleh menyetujui resep. Akun dibuat admin, bukan oleh nakes itu sendiri, supaya tidak ada yang bisa mendaftarkan diri sebagai dokter."
        actions={
          <Button onClick={() => setIsFormOpen(true)}>
            <UserPlusIcon aria-hidden="true" />
            Undang Staf
          </Button>
        }
      />

      <InviteStaffForm
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
          empty={accounts.length === 0}
          toolbar={
            <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <StethoscopeIcon className="mr-1.5 inline size-3.5" aria-hidden="true" />
              {accounts.length} akun
            </span>
          }
        >
          {accounts.length === 0 ? (
            <EmptyState
              icon={<StethoscopeIcon className="size-5" aria-hidden="true" />}
              title="Belum ada akun nakes"
              description="Undang staf dan tentukan peran klinis serta wilayah penugasannya."
            />
          ) : (
            <div className="data-table-scroll">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-3.5">Nama</th>
                    <th className="px-4 py-3.5">Kontak</th>
                    <th className="px-4 py-3.5">Peran Klinis</th>
                    <th className="px-4 py-3.5">Penugasan</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => {
                    const aktif = account.assignments.filter((a) => a.isActive)
                    return (
                      <tr key={account.id}>
                        <td className="px-4 py-4 font-medium">{account.fullName}</td>
                        <td className="px-4 py-4 font-mono text-muted-foreground">{account.phone}</td>
                        <td className="px-4 py-4">
                          <Badge
                            variant={
                              account.nakesRole === 'DOKTER' || account.nakesRole === 'BIDAN'
                                ? 'default'
                                : 'neutral'
                            }
                          >
                            {ROLE_LABEL[account.nakesRole] ?? account.nakesRole}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          {aktif.length === 0 ? (
                            <span className="text-muted-foreground">Tidak ada</span>
                          ) : (
                            <ul className="space-y-1">
                              {aktif.map((a) => (
                                <li key={a.id} className="flex items-center gap-2">
                                  <span className="text-xs">
                                    {a.puskesmasName ?? `Wilayah ${a.districtCode}`}
                                  </span>
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                    onClick={() => void closeAssignment(account, a.id)}
                                  >
                                    tutup
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={account.staffStatus} />
                        </td>
                        <td className="px-4 py-4">
                          <StaffActions
                            account={account}
                            onChangeStatus={(next) => void changeStatus(account, next)}
                            onChanged={load}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataTableShell>
      )}
    </>
  )
}

function StaffActions({
  account,
  onChangeStatus,
  onChanged,
}: {
  account: NakesAccount
  onChangeStatus: (status: StaffStatus) => void
  onChanged: () => Promise<void>
}) {
  const [isBusy, setIsBusy] = useState(false)

  const regenerate = async () => {
    setIsBusy(true)
    try {
      const result = await regenerateActivationCode(account.id)
      window.alert(`Kode aktivasi baru: ${result.activationCode}\n\nBerlaku sampai ${result.activationExpiresAt}`)
      await onChanged()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {account.staffStatus !== 'ACTIVE' && account.staffStatus !== 'DEACTIVATED' ? (
        <Button size="xs" variant="outline" disabled={isBusy} onClick={() => void regenerate()}>
          <KeyRoundIcon aria-hidden="true" />
          Kode baru
        </Button>
      ) : null}
      {account.staffStatus === 'ACTIVE' ? (
        <Button size="xs" variant="ghost" onClick={() => onChangeStatus('SUSPENDED')}>
          Tangguhkan
        </Button>
      ) : null}
      {account.staffStatus === 'SUSPENDED' ? (
        <Button size="xs" variant="ghost" onClick={() => onChangeStatus('ACTIVE')}>
          Aktifkan
        </Button>
      ) : null}
      {account.staffStatus !== 'DEACTIVATED' ? (
        <Button size="xs" variant="ghost" onClick={() => onChangeStatus('DEACTIVATED')}>
          Berhentikan
        </Button>
      ) : null}
    </div>
  )
}

function InviteStaffForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [nakesRole, setNakesRole] = useState('PERAWAT')
  const [useInvite, setUseInvite] = useState(true)
  const [password, setPassword] = useState('')
  const [clinicId, setClinicId] = useState('')
  const [districtCode, setDistrictCode] = useState('')
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activationCode, setActivationCode] = useState<string | null>(null)
  const { token } = useAuth()

  useEffect(() => {
    if (!open || !token) return
    void getClinics()
      .then(setClinics)
      .catch(() => setClinics([]))
  }, [open, token])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!fullName.trim() || !phone.trim()) {
      setError('Nama dan nomor HP wajib diisi')
      return
    }
    if (!clinicId && !districtCode.trim()) {
      setError('Pilih puskesmas atau isi kode wilayah penugasan')
      return
    }
    if (!useInvite && password.length < 8) {
      setError('Kata sandi minimal 8 karakter')
      return
    }

    setIsSaving(true)
    try {
      const result = await inviteNakesAccount({
        fullName: fullName.trim(),
        phone: phone.trim(),
        nakesRole,
        password: useInvite ? undefined : password,
        assignments: [
          clinicId ? { puskesmasId: clinicId } : { districtCode: districtCode.trim() },
        ],
      })

      if (result.activationCode) {
        setActivationCode(result.activationCode)
        window.alert(
          `Kode aktivasi untuk ${result.account.fullName}: ${result.activationCode}\n\n` +
            'Berikan kode ini ke staf. Hanya ditampilkan sekali.',
        )
      }
      setFullName('')
      setPhone('')
      setPassword('')
      setClinicId('')
      setDistrictCode('')
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal membuat akun nakes')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader icon={<StethoscopeIcon className="size-4" />}>
          <SheetTitle>Undang Staf</SheetTitle>
          <SheetDescription>
            Peran klinis menentukan kewenangan: dokter dan bidan boleh menyetujui resep, apotek
            hanya menyiapkan dan menyerahkan obat.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {error ? (
              <Alert variant="danger" icon={<TriangleAlertIcon />}>
                {error}
              </Alert>
            ) : null}

            {activationCode ? (
              <Alert variant="info" icon={<KeyRoundIcon />}>
                Kode aktivasi terakhir: <span className="font-mono font-semibold">{activationCode}</span>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nakes-name">Nama lengkap</Label>
                <Input id="nakes-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nakes-phone">Nomor HP</Label>
                <Input
                  id="nakes-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0811xxxxxxx"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nakes-role">Peran klinis</Label>
                <NativeSelect
                  id="nakes-role"
                  value={nakesRole}
                  onChange={(e) => setNakesRole(e.target.value)}
                >
                  <option value="PERAWAT">Perawat</option>
                  <option value="DOKTER">Dokter</option>
                  <option value="BIDAN">Bidan</option>
                  <option value="KADER">Kader</option>
                  {/* Apotek boleh menyiapkan & menyerahkan obat, tapi tidak boleh
                      menyetujui resep atau permintaan obat (docs/API.md §3.6). */}
                  <option value="FARMASI">Farmasi (Apoteker)</option>
                  <option value="LAINNYA">Lainnya</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nakes-invite-mode">Cara aktivasi</Label>
                <NativeSelect
                  id="nakes-invite-mode"
                  value={useInvite ? 'invite' : 'password'}
                  onChange={(e) => setUseInvite(e.target.value === 'invite')}
                >
                  <option value="invite">Kirim kode aktivasi (disarankan)</option>
                  <option value="password">Buat kata sandi sekarang</option>
                </NativeSelect>
              </div>

              {!useInvite ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="nakes-password">Kata sandi awal</Label>
                  <Input
                    id="nakes-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="nakes-clinic">Puskesmas penugasan</Label>
                <NativeSelect
                  id="nakes-clinic"
                  value={clinicId}
                  onChange={(e) => setClinicId(e.target.value)}
                >
                  <option value="">— Pilih puskesmas —</option>
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nakes-district">Kode wilayah (bila tanpa puskesmas)</Label>
                <Input
                  id="nakes-district"
                  value={districtCode}
                  onChange={(e) => setDistrictCode(e.target.value)}
                  placeholder="3471"
                  disabled={Boolean(clinicId)}
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
              {useInvite ? 'Kirim Undangan' : 'Buat Akun'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/** Panel kecil untuk menambah penugasan tanpa membuat akun baru. */
export function AddAssignmentPanel({ staffId }: { staffId: string }) {
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicId, setClinicId] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getClinics()
      .then(setClinics)
      .catch(() => setClinics([]))
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await addNakesAssignment(staffId, { puskesmasId: clinicId, note })
      setMessage('Penugasan ditambahkan.')
      setClinicId('')
      setNote('')
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Gagal menambah penugasan')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <NativeSelect value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
        <option value="">— Pilih puskesmas —</option>
        {clinics.map((clinic) => (
          <option key={clinic.id} value={clinic.id}>
            {clinic.name}
          </option>
        ))}
      </NativeSelect>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" />
      <Button type="submit" size="sm" variant="outline">
        <MapPinIcon aria-hidden="true" />
        Tambah penugasan
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </form>
  )
}