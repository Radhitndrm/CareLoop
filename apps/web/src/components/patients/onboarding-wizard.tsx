'use client'

// Wizard pendaftaran pasien (Fase C plan operasional).
//
// Alurnya sengaja berurutan: cek duplikasi dulu, baru isi data, baru keluarga, baru
// consent. Urutan ini yang mencegah dua masalah yang paling mahal di puskesmas —
//pasien yang terdaftar dua kali, dan pasien tanpa tujuan eskalasi.
//
// Form sengaja disimpan sebagai draft (ONBOARDING) di langkah terakhir. Activation
// tidak dilakukan di sini: itu keputusan klinis terpisah yang punya checklist sendiri.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleAlertIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import {
  createFamilyContact,
  createPatient,
  getClinics,
  lookupPatients,
  sendVerificationInstructions,
  type Clinic,
  type LookupMatch,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'

const STEPS = [
  { key: 'cari', title: 'Cari duplikasi', hint: 'Cek nomor WhatsApp atau NIK sebelum membuat data baru.' },
  { key: 'identitas', title: 'Identitas', hint: 'Nama, nomor WhatsApp, dan data dasar pasien.' },
  { key: 'wilayah', title: 'Wilayah', hint: 'Puskesmas penanggung jawab menentukan siapa yang bisa menindaklanjuti.' },
  { key: 'kondisi', title: 'Kondisi', hint: 'Dipakai untuk filter dashboard dan sebagai acuan drafting resep.' },
  { key: 'keluarga', title: 'Kontak keluarga', hint: 'Tanpa minimal satu kontak, eskalasi tidak punya tujuan.' },
  { key: 'consent', title: 'Persetujuan', hint: 'Persetujuan PDP wajib dicatat sebelum pasien bisa diaktifkan.' },
] as const

const RELATIONSHIP_OPTIONS = [
  { value: 'ANAK', label: 'Anak' },
  { value: 'PASANGAN', label: 'Pasangan' },
  { value: 'SAUDARA', label: 'Saudara' },
  { value: 'CUCU', label: 'Cucu' },
  { value: 'KEPONAKAN', label: 'Keponakan' },
  { value: 'TETANGGA', label: 'Tetangga' },
  { value: 'LAINNYA', label: 'Lainnya' },
]

const CONDITION_OPTIONS = ['DIABETES', 'HIPERTENSI', 'GAGAL JANTUNG', 'ASTHMA', 'TBC', 'STROKE']

export interface OnboardingWizardProps {
  onDone: (patientId: string) => void
  onCancel: () => void
}

export function OnboardingWizard({ onDone, onCancel }: OnboardingWizardProps) {
  const { token } = useAuth()
  const [step, setStep] = useState(0)

  // Langkah 1 — deteksi duplikasi
  const [lookupPhone, setLookupPhone] = useState('')
  const [lookupNik, setLookupNik] = useState('')
  const [matches, setMatches] = useState<LookupMatch[] | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [isLooking, setIsLooking] = useState(false)

  // Langkah 2–4
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [nik, setNik] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState('F')
  const [clinicId, setClinicId] = useState('')
  const [districtCode, setDistrictCode] = useState('')
  const [address, setAddress] = useState('')
  const [livingSituation, setLivingSituation] = useState('WITH_FAMILY')
  const [conditions, setConditions] = useState<string[]>([])
  const [otherCondition, setOtherCondition] = useState('')

  // Langkah 5
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactRelationship, setContactRelationship] = useState('ANAK')
  const [contactTier, setContactTier] = useState<'TIER_1' | 'TIER_2'>('TIER_1')
  const [contactCanReceive, setContactCanReceive] = useState(true)

  // Langkah 6
  const [consentShare, setConsentShare] = useState(true)

  const [clinics, setClinics] = useState<Clinic[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    void getClinics()
      .then(setClinics)
      .catch(() => setClinics([]))
  }, [token])

  const runLookup = useCallback(async () => {
    setIsLooking(true)
    setLookupError(null)
    try {
      const result = await lookupPatients({
        phone: lookupPhone.trim() || undefined,
        nik: lookupNik.trim() || undefined,
      })
      setMatches(result.matches)
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Gagal memeriksa data yang ada')
    } finally {
      setIsLooking(false)
    }
  }, [lookupPhone, lookupNik])

  const duplicate = useMemo(() => matches?.find((m) => m.kind !== 'NOT_A_PATIENT') ?? null, [matches])
  const nonPatientConflict = useMemo(() => matches?.find((m) => m.kind === 'NOT_A_PATIENT') ?? null, [matches])

  const missingFields = useMemo(() => {
    const missing: string[] = []
    if (!fullName.trim()) missing.push('nama lengkap')
    if (!phone.trim()) missing.push('nomor WhatsApp')
    if (!dateOfBirth) missing.push('tanggal lahir')
    if (!clinicId) missing.push('puskesmas')
    if (conditions.length === 0) missing.push('kondisi penyakit')
    return missing
  }, [fullName, phone, dateOfBirth, clinicId, conditions])

  const canFinish = missingFields.length === 0 && consentShare

  const saveDraft = async () => {
    if (!canFinish) return
    setIsSaving(true)
    setError(null)
    try {
      const created = await createPatient({
        fullName: fullName.trim(),
        phone: phone.trim(),
        districtCode: districtCode.trim() || '0000',
        puskesmasId: clinicId,
        nik: nik.trim() || undefined,
        gender: gender === 'M' ? 'M' : 'F',
        dateOfBirth: dateOfBirth || undefined,
        address: address.trim() || undefined,
        livingSituation,
        healthConditions: conditions,
        consentShareWithNakes: consentShare,
      })

      // Kontak keluarga disimpan setelah pasien ada, karena butuh patientId.
      if (contactName.trim() && contactPhone.trim()) {
        await createFamilyContact(created.id, {
          name: contactName.trim(),
          phone: contactPhone.trim(),
          relationship: contactRelationship,
          tier: contactTier,
          canReceiveEmergency: contactCanReceive,
          canViewHealth: true,
        }).catch(() => undefined)
      }

      // Instruksi OTP dikirim otomatis, tapi kegagalan tidak membatalkan pendaftaran:
      // status tetap ONBOARDING dan operator bisa mengirim ulang kapan saja.
      try {
        await sendVerificationInstructions(created.id)
        setNotice('Instruksi verifikasi WhatsApp sudah dikirim ke pasien.')
      } catch {
        setNotice('Pasien tersimpan. Instruksi verifikasi belum terkirim — kirim ulang dari detail pasien.')
      }

      onDone(created.id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pasien')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Langkah pendaftaran">
        {STEPS.map((item, index) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => index <= step && setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                index === step
                  ? 'bg-primary text-primary-foreground'
                  : index < step
                    ? 'bg-secondary text-secondary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {index + 1}. {item.title}
            </button>
          </li>
        ))}
      </ol>

      <div>
        <h3 className="text-base font-semibold">{STEPS[step].title}</h3>
        <p className="text-sm text-muted-foreground">{STEPS[step].hint}</p>
      </div>

      {error ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="info" icon={<CheckIcon />}>
          {notice}
        </Alert>
      ) : null}

      {step === 0 ? (
        <div className="space-y-4">
          {lookupError ? (
            <Alert variant="danger" icon={<TriangleAlertIcon />}>
              {lookupError}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lookup-phone">Nomor WhatsApp</Label>
              <Input
                id="lookup-phone"
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value)}
                placeholder="0812xxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lookup-nik">NIK (opsional)</Label>
              <Input
                id="lookup-nik"
                value={lookupNik}
                onChange={(e) => setLookupNik(e.target.value)}
                placeholder="16 digit"
              />
            </div>
          </div>

          <Button variant="outline" disabled={isLooking} onClick={() => void runLookup()}>
            <SearchIcon aria-hidden="true" />
            {isLooking ? 'Mencari…' : 'Cari data yang ada'}
          </Button>

          {matches !== null && matches.length === 0 ? (
            <Alert variant="success" icon={<CheckIcon />}>
              Nomor ini belum terdaftar. Lanjutkan ke langkah berikutnya.
            </Alert>
          ) : null}

          {duplicate ? (
            <Alert variant="warning" icon={<CircleAlertIcon />}>
              <p>{duplicate.hint}</p>
              {duplicate.patientId ? (
                <p className="mt-1 text-xs">
                  Pasien: {duplicate.fullName} · status {duplicate.status ?? 'tidak diketahui'}
                </p>
              ) : null}
            </Alert>
          ) : null}

          {nonPatientConflict ? (
            <Alert variant="warning" icon={<CircleAlertIcon />}>
              {nonPatientConflict.hint}
            </Alert>
          ) : null}

          {duplicate?.patientId ? (
            <Alert variant="info">
              <p>
                Nomor ini sudah terdaftar sebagai pasien di wilayah Anda. Buka detailnya untuk melengkapi
                data, bukan membuat pasien baru.
              </p>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="wiz-name">Nama lengkap</Label>
            <Input id="wiz-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-phone">Nomor WhatsApp</Label>
            <Input
              id="wiz-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0812xxxxxxx"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-nik">NIK (opsional)</Label>
            <Input id="wiz-nik" value={nik} onChange={(e) => setNik(e.target.value)} placeholder="16 digit" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-dob">Tanggal lahir</Label>
            <Input
              id="wiz-dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-gender">Jenis kelamin</Label>
            <NativeSelect id="wiz-gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="F">Perempuan</option>
              <option value="M">Laki-laki</option>
            </NativeSelect>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="wiz-clinic">Puskesmas penanggung jawab</Label>
            <NativeSelect
              id="wiz-clinic"
              value={clinicId}
              onChange={(e) => {
                setClinicId(e.target.value)
                const chosen = clinics.find((c) => c.id === e.target.value)
                if (chosen?.districtCode) setDistrictCode(chosen.districtCode)
              }}
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
            <Label htmlFor="wiz-district">Kode wilayah</Label>
            <Input id="wiz-district" value={districtCode} onChange={(e) => setDistrictCode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-living">Situasi tinggal</Label>
            <NativeSelect
              id="wiz-living"
              value={livingSituation}
              onChange={(e) => setLivingSituation(e.target.value)}
            >
              <option value="WITH_FAMILY">Tinggal bersama keluarga</option>
              <option value="ALONE">Tinggal sendiri</option>
              <option value="FAR_FROM_FAMILY">Jauh dari keluarga</option>
              <option value="OTHER">Lainnya</option>
            </NativeSelect>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="wiz-address">Alamat</Label>
            <Textarea id="wiz-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wiz-condition">Kondisi penyakit</Label>
            <div className="flex flex-wrap gap-2">
              {CONDITION_OPTIONS.map((option) => {
                const active = conditions.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setConditions((prev) =>
                        prev.includes(option)
                          ? prev.filter((c) => c !== option)
                          : [...prev, option],
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-primary'
                    }`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-condition-other">Kondisi lain (opsional)</Label>
            <Input
              id="wiz-condition-other"
              value={otherCondition}
              onChange={(e) => setOtherCondition(e.target.value)}
              placeholder="mis. INSUFIENSI GINJAL"
            />
            <p className="text-xs text-muted-foreground">
              Ditambahkan sebagai kondisi tambahan, bukan diagnosis.
            </p>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="wiz-contact-name">Nama kontak</Label>
            <Input
              id="wiz-contact-name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-contact-phone">Nomor WhatsApp</Label>
            <Input
              id="wiz-contact-phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="0812xxxxxxx"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-contact-rel">Hubungan</Label>
            <NativeSelect
              id="wiz-contact-rel"
              value={contactRelationship}
              onChange={(e) => setContactRelationship(e.target.value)}
            >
              {RELATIONSHIP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wiz-contact-tier">Tier eskalasi</Label>
            <NativeSelect
              id="wiz-contact-tier"
              value={contactTier}
              onChange={(e) => setContactTier(e.target.value === 'TIER_2' ? 'TIER_2' : 'TIER_1')}
            >
              <option value="TIER_1">Tier 1 — dihubungi lebih dulu</option>
              <option value="TIER_2">Tier 2 — cadangan</option>
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="wiz-contact-receive"
              type="checkbox"
              checked={contactCanReceive}
              onChange={(e) => setContactCanReceive(e.target.checked)}
            />
            <Label htmlFor="wiz-contact-receive">Izinkan menerima alert darurat</Label>
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <input
              id="wiz-consent"
              type="checkbox"
              checked={consentShare}
              onChange={(e) => setConsentShare(e.target.checked)}
              className="mt-1"
            />
            <div>
              <Label htmlFor="wiz-consent">
                Pasien menyetujui pemrosesan data dan berbagi informasi kesehatan dengan tenaga
                kesehatan
              </Label>
              <p className="text-xs text-muted-foreground">
                Tanpa persetujuan ini pasien tidak bisa diaktifkan dan tidak akan menerima pengingat.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-semibold">Ringkasan</p>
            <dl className="mt-2 grid gap-1 text-muted-foreground">
              <div>Nama: {fullName || '—'}</div>
              <div>Nomor: {phone || '—'}</div>
              <div>Puskesmas: {clinics.find((c) => c.id === clinicId)?.name ?? '—'}</div>
              <div>Kondisi: {conditions.length > 0 ? conditions.join(', ') : '—'}</div>
              <div>Kontak keluarga: {contactName || 'belum diisi'}</div>
            </dl>
            {missingFields.length > 0 ? (
              <p className="mt-3 text-xs text-destructive-foreground">
                Masih kosong: {missingFields.join(', ')}.
              </p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Data disimpan sebagai <strong>ONBOARDING</strong>. Pengingat obat baru berjalan setelah
            resep disetujui dan pasien diaktifkan.
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
        >
          <ArrowLeftIcon aria-hidden="true" />
          {step === 0 ? 'Batal' : 'Sebelumnya'}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)}>
            Berikutnya
            <ArrowRightIcon aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" disabled={!canFinish || isSaving} onClick={() => void saveDraft()}>
            {isSaving ? (
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            Simpan sebagai onboarding
          </Button>
        )}
      </div>
    </div>
  )
}