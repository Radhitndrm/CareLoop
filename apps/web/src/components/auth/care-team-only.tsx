'use client'

import Link from 'next/link'
import { PillIcon, ShieldCheckIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

/**
 * Halaman yang hanya untuk tenaga kesehatan (dashboard, daftar & data pasien).
 *
 * Apoteker memakai aplikasi ini lewat web juga, tetapi tugasnya preparation &
 * surrendering obat — bukan memantau kepatuhan pasien. UI ini menjaga agar
 * apoteker tidak sampai membuka `/patients` yang memuat NIK, alamat, riwayat
 * penyakit, dan skor risiko yang tidak diperlukan untuk menyiapkan obat.
 *
 * Ini sendiri TIDAK cukup sebagai pengaman: gerbang sesungguhnya ada di server
 * (`requireCareTeamRole` di lib/auth.ts). Halaman ini hanya agar yang terjadi
 * adalah pesan penjelasan — bukan error 403 yang membingungkan.
 */
export function CareTeamOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) return null

  if (user && user.role !== 'ADMIN' && user.nakesRole === 'FARMASI') {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CardContent>
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-accent text-primary">
            <ShieldCheckIcon className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            Halaman ini khusus tenaga kesehatan. Untuk petugas farmasi, tugas Anda ada di Antrean
            Obat.
          </p>
          <Button asChild className="mt-5">
            <Link href="/pharmacy/queue">
              <PillIcon aria-hidden="true" />
              Buka Antrean Obat
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}