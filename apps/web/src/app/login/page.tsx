'use client'

import { useState, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon, KeyRoundIcon, PillIcon, ShieldCheckIcon, StethoscopeIcon, TriangleAlertIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Input, Label } from '@/components/ui/input'

const DEMO_ACCOUNTS = [
  {
    icon: StethoscopeIcon,
    id: '081100000001',
    label: 'Dokter',
    note: 'Bisa menyetujui resep & ambang detak jantung',
  },
  {
    icon: ShieldCheckIcon,
    id: '081100000004',
    label: 'Perawat',
    note: 'Bisa membuat draft, tidak bisa menyetujui',
  },
  {
    icon: ShieldCheckIcon,
    id: '081100000003',
    label: 'Admin Dinkes',
    note: 'Kelola akun nakes, akses seluruh wilayah',
  },
  {
    icon: PillIcon,
    id: '081100000005',
    label: 'Apoteker',
    note: 'Bisa antre & serahkan obat, tidak bisa menyetujui',
  },
]

const DEMO_PASSWORD = 'CareLoop#Demo2026'

export default function LoginPage() {
  const router = useRouter()
  const { login, isAuthenticated } = useAuth()

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard')
    }
  }, [isAuthenticated, router])

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setErrorMsg('')
    if (!identifier.trim() || !password) {
      setErrorMsg('Silakan masukkan nomor HP / email dan kata sandi')
      return
    }

    setIsSubmitting(true)
    try {
      await login(identifier.trim(), password)
      router.push('/dashboard')
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal masuk. Periksa nomor HP / email dan kata sandi Anda.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const fillDemo = (id: string) => {
    setIdentifier(id)
    setPassword(DEMO_PASSWORD)
    setErrorMsg('')
  }

  return (
    <div className="app-workspace flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_26rem]">
        <section className="hidden flex-col justify-center lg:flex">
          <p className="page-kicker">
            <span aria-hidden="true" />
            Portal petugas
          </p>
          <h1 className="text-[clamp(2rem,3.4vw,2.8rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
            Satu panel untuk kepatuhan, risiko, dan kegawatdaruratan.
          </h1>
          <p className="page-description">
            Petugas masuk dengan nomor HP atau email. Hak akses mengikuti peran klinis masing-masing
            dan ditegakkan ulang di server.
          </p>
          <ul className="mt-8 space-y-3">
{[
              'Reminder obat & konfirmasi satu ketukan lewat WhatsApp',
              'Panel darurat real-time dengan lokasi pasien',
              'Antrean obat dan riwayat penyerahan',
              'Eskalasi bertingkat: pasien → keluarga → nakes',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-border bg-card p-7 shadow-plate">
          <div className="mb-7 text-center">
            <BrandMark className="mx-auto mb-3" />
            <h2 className="text-xl font-semibold tracking-[-0.015em]">Masuk ke CareLoop</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Portal dashboard pemantauan kepatuhan &amp; darurat
            </p>
          </div>

          {errorMsg ? (
            <Alert variant="danger" icon={<TriangleAlertIcon />} className="mb-5">
              {errorMsg}
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Nomor HP atau Email</Label>
              <Input
                id="identifier"
                required
                placeholder="081100000001 atau dokter@careloop.id"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Kata Sandi</Label>
              <Input
                id="password"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <KeyRoundIcon aria-hidden="true" />
              )}
              Masuk ke Dashboard
            </Button>
          </form>

          <div className="mt-7 border-t border-border pt-5">
            <p className="mb-3 text-center text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Demo hackathon — isi cepat
            </p>
            <div className="grid gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => fillDemo(account.id)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <account.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{account.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{account.note}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Akun &amp; data di atas sintetis untuk demo.
            </p>
          </div>
        </section>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeftIcon aria-hidden="true" />
            Kembali ke beranda
          </Link>
        </Button>
      </div>
    </div>
  )
}