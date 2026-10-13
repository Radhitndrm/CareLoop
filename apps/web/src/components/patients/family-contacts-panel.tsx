'use client'

// Manajemen kontak keluarga untuk satu pasien.
//
// Kontak ini adalah tujuan eskalasi. Tanpa minimal satu kontak yang boleh menerima
// alert, eskalasi tidak punya tujuan — jadi panel ini menampilkan batas minimal itu,
// bukan sekadar form kosong.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Trash2Icon, TriangleAlertIcon, UserPlusIcon } from 'lucide-react'
import {
  createFamilyContact,
  deleteFamilyContact,
  getFamilyContacts,
  type FamilyContact,
} from '@/lib/api'
import { Alert } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'

const RELATIONSHIP_LABEL: Record<string, string> = {
  ANAK: 'Anak',
  PASANGAN: 'Pasangan',
  SAUDARA: 'Saudara',
  CUCU: 'Cucu',
  KEPONAKAN: 'Keponakan',
  TETANGGA: 'Tetangga',
  LAINNYA: 'Lainnya',
}

export function FamilyContactsPanel({ patientId }: { patientId: string }) {
  const [contacts, setContacts] = useState<FamilyContact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relationship, setRelationship] = useState('ANAK')
  const [tier, setTier] = useState<'TIER_1' | 'TIER_2'>('TIER_1')
  const [canReceiveEmergency, setCanReceiveEmergency] = useState(true)
  const [canViewHealth, setCanViewHealth] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setContacts(await getFamilyContacts(patientId))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat kontak keluarga')
    } finally {
      setIsLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      setIsLoading(true)
      try {
        const result = await getFamilyContacts(patientId)
        if (!isCancelled) {
          setContacts(result)
          setError(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat kontak keluarga')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [patientId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!name.trim() || !phone.trim()) {
      setError('Nama dan nomor WhatsApp kontak wajib diisi')
      return
    }

    setIsSaving(true)
    try {
      await createFamilyContact(patientId, {
        name: name.trim(),
        phone: phone.trim(),
        relationship,
        tier,
        canReceiveEmergency,
        canViewHealth,
      })
      setName('')
      setPhone('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan kontak')
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (contact: FamilyContact) => {
    try {
      await deleteFamilyContact(contact.id)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus kontak')
    }
  }

  const reachable = contacts.filter((c) => c.isActive && c.canReceiveEmergency)
  const belumAda = reachable.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kontak Keluarga</CardTitle>
        <CardDescription>
          Tujuan eskalasi saat pasien tidak merespons pengingat. Tanpa minimal satu kontak yang
          boleh menerima alert, pasien tidak bisa diaktifkan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="danger" icon={<TriangleAlertIcon />}>
            {error}
          </Alert>
        ) : null}

        {belumAda ? (
          <Alert variant="warning" icon={<TriangleAlertIcon />}>
            Belum ada kontak yang boleh menerima alert. Eskalasi tidak akan sampai ke siapa pun.
          </Alert>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat kontak…</p>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={<UserPlusIcon className="size-5" aria-hidden="true" />}
            title="Belum ada kontak"
            description="Tambahkan minimal satu kontak keluarga atau nakes yang bisa dihubungi."
          />
        ) : (
          <ul className="space-y-2">
            {contacts.map((contact) => (
              <li
                key={contact.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{contact.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{contact.phone}</span>
                <Badge variant="neutral">{RELATIONSHIP_LABEL[contact.relationship] ?? contact.relationship}</Badge>
                <Badge variant={contact.tier === 'TIER_1' ? 'info' : 'neutral'}>{contact.tier}</Badge>
                {!contact.canReceiveEmergency ? <Badge variant="warning">Tanpa izin alert</Badge> : null}
                {!contact.isActive ? <Badge variant="neutral">Nonaktif</Badge> : null}
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void remove(contact)}
                >
                  <Trash2Icon aria-hidden="true" />
                  Hapus
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fc-name">Nama</Label>
              <Input id="fc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fc-phone">Nomor WhatsApp</Label>
              <Input
                id="fc-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812xxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fc-rel">Hubungan</Label>
              <NativeSelect
                id="fc-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
              >
                {Object.entries(RELATIONSHIP_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fc-tier">Tier</Label>
              <NativeSelect
                id="fc-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value === 'TIER_2' ? 'TIER_2' : 'TIER_1')}
              >
                <option value="TIER_1">Tier 1 — dihubungi lebih dulu</option>
                <option value="TIER_2">Tier 2 — cadangan</option>
              </NativeSelect>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canReceiveEmergency}
                onChange={(e) => setCanReceiveEmergency(e.target.checked)}
              />
              Boleh menerima alert darurat
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canViewHealth}
                onChange={(e) => setCanViewHealth(e.target.checked)}
              />
              Boleh melihat informasi kesehatan
            </label>
          </div>

          <Button type="submit" size="sm" disabled={isSaving}>
            {isSaving ? (
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            Tambah kontak
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}