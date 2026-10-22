'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { ActivityIcon, ArrowUpRightIcon, BellRingIcon, CheckCircleIcon, FilterIcon, LayoutDashboardIcon, PillIcon, ShieldAlertIcon, StethoscopeIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react'
import { BrandMark } from '@/components/brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FEATURES = [
  {
    icon: LayoutDashboardIcon,
    title: 'Ringkasan Kepatuhan',
    body: 'KPI adherence rate, dosis tepat waktu, terlambat, dan terlewat dalam satu layar.',
  },
  {
    icon: ActivityIcon,
    title: 'Grafik Tren Harian',
    body: 'Deret waktu kepatuhan harian plus rincian per jenis penyakit.',
  },
  {
    icon: ShieldAlertIcon,
    title: 'Deteksi Risiko Tinggi',
    body: 'Pasien dengan skor risiko ≥ 70 dan MDPAP tinggal sendiri disorot otomatis.',
  },
  {
    icon: FilterIcon,
    title: 'Filter Bookmarkable',
    body: 'Wilayah, penyakit, rentang tanggal, dan status eskalasi tersimpan di URL.',
  },
  {
    icon: BellRingIcon,
    title: 'Panel Darurat Real-Time',
    body: 'Notifikasi anomali detak jantung via WebSocket, lengkap dengan lokasi pasien.',
  },
  {
    icon: StethoscopeIcon,
    title: 'Eskalasi Bertingkat',
    body: 'Pasien → keluarga → nakes, dengan timeout yang diatur per tingkat.',
  },
]

const FLOW = [
  {
    step: '01',
    icon: PillIcon,
    title: 'Dokter menetapkan obat',
    body: 'Dokter menyetujui resep, jadwal minum diterjemahkan jadi pengingat WhatsApp.',
  },
  {
    step: '02',
    icon: CheckCircleIcon,
    title: 'Konfirmasi satu ketukan',
    body: 'Pasien menekan "sudah minum" di WhatsApp. Tidak terkirim berarti dianggap belum diminum.',
  },
  {
    step: '03',
    icon: TriangleAlertIcon,
    title: 'Eskalasi otomatis',
    body: 'Kepatuhan menurun memicu menghubungi keluarga, lalu nakes dan faskes terdekat.',
  },
]

// Kurva perlambatan halus (smooth deceleration) ala Apple iOS
const SMOOTH_EASE = [0.16, 1, 0.3, 1] as const

export default function HomePage() {
  return (
    <div className="app-workspace min-h-screen w-full">
      <header className="app-topbar">
        <div className="topbar-inner mx-auto w-full max-w-360 px-4 md:px-7 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BrandMark />
            <span className="min-w-0">
              <span className="brand-name block">CareLoop</span>
              <span className="brand-caption block truncate">
                Monitoring Kepatuhan &amp; Darurat
              </span>
            </span>
          </div>
          <div className="topbar-account">
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Masuk</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard">
                Dashboard Nakes
                <ArrowUpRightIcon aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-360 space-y-12 px-4 py-10 md:px-7 md:py-14 lg:px-8">
        <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: SMOOTH_EASE }}
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            className="transform-[translateZ(0)]"
          >
            <p className="page-kicker">
              <span aria-hidden="true" />
              SDG 3 · Digital Health
            </p>
            <h1 className="text-[clamp(2.2rem,5vw,3.6rem)] leading-[1.02] font-semibold tracking-[-0.03em] text-balance">
              Kepatuhan obat yang tidak lagi bergantung pada ingatan.
            </h1>
            <p className="page-description">
              CareLoop mengirim pengingat lewat WhatsApp, mencatat konfirmasi, dan mendeteksi
              anomali detak jantung — lalu menghubungi keluarga dan tenaga kesehatan bila perlu
              melakukan eskalasi.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Buka Dashboard Nakes
                  <ArrowUpRightIcon aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/login">Masuk Portal Petugas</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <Badge variant="success">
                <CheckCircleIcon aria-hidden="true" />
                Reminder WhatsApp otomatis
              </Badge>
              <Badge variant="neutral">
                <UsersIcon aria-hidden="true" />
                Multi-peran nakes
              </Badge>
              <Badge variant="neutral">Data demo sintetis</Badge>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: SMOOTH_EASE }}
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            className="transform-[translateZ(0)]"
          >
            <Card className="card-fold">
              <CardHeader>
                <CardTitle>Alur utama platform</CardTitle>
                <CardDescription>Tiga langkah inti platform.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {FLOW.map((item) => (
                    <li key={item.step} className="flex gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                        <item.icon className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{item.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        <section className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5, ease: SMOOTH_EASE }}
          >
            <p className="page-kicker">
              <span aria-hidden="true" />
              Fitur utama
            </p>
            <h2 className="page-title">Semua yang dibutuhkan petugas kesehatan</h2>
          </motion.div>

          {/* Grid kartu dengan animasi meluncur naik saat masuk viewport / refresh */}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.08,
                  ease: SMOOTH_EASE,
                }}
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                }}
                className="h-full transform-[translateZ(0)]"
              >
                <Card className="h-full">
                  <CardHeader>
                    <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
                      <feature.icon className="size-5" aria-hidden="true" />
                    </span>
                    <CardTitle>{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-360 flex-wrap justify-between gap-2 border-t px-4 py-6 text-xs text-muted-foreground md:px-7 lg:px-8">
        <span>CareLoop · Kepatuhan pengobatan &amp; deteksi darurat.</span>
        <span className="flex items-center gap-1">
          Data demo sintetis, bukan data pasien riil
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </span>
      </footer>
    </div>
  )
}
