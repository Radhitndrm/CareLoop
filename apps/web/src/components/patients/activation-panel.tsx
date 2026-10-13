'use client'

// Checklist aktivasi pasien (Fase A/D plan operasional).
//
// Panel ini hanya menampilkan; keputusan tetap dihitung ulang di server saat operator
// menekan tombol Aktifkan. Yang ditampilkan di sini adalah *kenapa* tombol itu belum
// bisa ditekan, lengkap dengan tautan ke layar yang perlu diperbaiki — supaya operator
// tidak pernah menebak-nebak apa yang kurang.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  Loader2Icon,
  PowerIcon,
  SendIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import {
  activatePatient,
  getPatientActivation,
  sendVerificationInstructions,
  type ActivationChecklist,
  type PatientStatus,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Alert } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const STATUS_LABEL: Record<PatientStatus, string> = {
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Aktif',
  INACTIVE: 'Ditangguhkan',
  BLOCKED: 'Diblokir',
}

/** Hanya dokter, bidan, dan admin yang boleh menaikkan status ke ACTIVE. */
function canDecide(user: ReturnType<typeof useAuth>['user']): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  return user.role === 'NAKES' && (user.nakesRole === 'DOKTER' || user.nakesRole === 'BIDAN')
}

export function ActivationPanel({
  patientId,
  status,
  onActivated,
}: {
  patientId: string
  status: PatientStatus
  onActivated: () => void
}) {
  const { user } = useAuth()
  const [checklist, setChecklist] = useState<ActivationChecklist | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActivating, setIsActivating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setChecklist(await getPatientActivation(patientId))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat checklist aktivasi')
    } finally {
      setIsLoading(false)
    }
  }, [patientId])

  // Fetch ditulis inline di dalam effect supaya ada penjaga pembatalan; `load`
  // tetap dipakai ulang setelah mutasi (aktivasi).
  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      setIsLoading(true)
      try {
        const result = await getPatientActivation(patientId)
        if (!isCancelled) {
          setChecklist(result)
          setError(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat checklist aktivasi')
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

  const activate = async () => {
    setIsActivating(true)
    setError(null)
    try {
      await activatePatient(patientId)
      setMessage('Pasien diaktifkan. Pengingat dan eskalasi mulai berjalan.')
      await load()
      onActivated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengaktifkan pasien')
    } finally {
      setIsActivating(false)
    }
  }

  const resendInstructions = async () => {
    setIsSending(true)
    setError(null)
    try {
      const result = await sendVerificationInstructions(patientId)
      setMessage(`Instruksi dikirim ke ${result.maskedPhone}. Coba lagi dalam ${result.retryAfterSec} detik.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim instruksi verifikasi')
    } finally {
      setIsSending(false)
    }
  }

  const unverified = checklist?.checks.find((check) => check.key === 'VERIFIED')?.satisfied === false

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aktivasi Pasien</CardTitle>
        <CardDescription>
          Hanya pasien berstatus Aktif yang menerima pengingat obat dan eskalasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status sekarang</span>
          <Badge variant={status === 'ACTIVE' ? 'success' : status === 'ONBOARDING' ? 'warning' : 'neutral'}>
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>

        {error ? (
          <Alert variant="danger" icon={<TriangleAlertIcon />}>
            {error}
          </Alert>
        ) : null}
        {message ? <Alert variant="success">{message}</Alert> : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat checklist…</p>
        ) : checklist ? (
          <ul className="space-y-2">
            {checklist.checks.map((check) => (
              <li key={check.key} className="flex items-start gap-2 text-sm">
                {check.satisfied ? (
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <div>
                  <p className={check.satisfied ? 'text-muted-foreground line-through' : 'font-medium'}>
                    {check.label}
                  </p>
                  {!check.satisfied && check.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {check.detail}
                      {check.fixPath ? (
                        <>
                          {' '}
                          <Link href={check.fixPath} className="underline underline-offset-2">
                            Perbaiki
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {unverified ? (
            <Button variant="outline" disabled={isSending} onClick={() => void resendInstructions()}>
              {isSending ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendIcon aria-hidden="true" />
              )}
              Kirim ulang instruksi OTP
            </Button>
          ) : null}

          {status !== 'ACTIVE' ? (
            <Button
              disabled={!checklist?.ready || isActivating || !canDecide(user)}
              onClick={() => void activate()}
            >
              {isActivating ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PowerIcon aria-hidden="true" />
              )}
              Aktifkan pasien
            </Button>
          ) : null}
        </div>

        {status !== 'ACTIVE' && !canDecide(user) ? (
          <p className="text-xs text-muted-foreground">
            Aktivasi hanya bisa dilakukan dokter, bidan, atau admin. Perawat dan kader tetap bisa
            melengkapi data di bawah.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}