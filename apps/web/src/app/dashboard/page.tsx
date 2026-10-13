'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { LogInIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import type { DashboardFilterInput } from '@careloop/shared'
import {
  getDashboardSummary,
  getDashboardAdherence,
  getDashboardRiskPatients,
  type DashboardSummary,
  type DashboardAdherence,
  type AtRiskPatient,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { PageHeader } from '@/components/page-header'
import { AccountCard } from '@/components/account-card'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { HealthHero } from '@/components/dashboard/health-hero'
import { StatStrip } from '@/components/dashboard/stat-strip'
import { FilterTabs } from '@/components/dashboard/filter-tabs'
import { EmergencyCard } from '@/components/dashboard/emergency-card'
import { AdherenceTrendCard, DiseaseMetersCard } from '@/components/dashboard/adherence-chart'
import { RiskTable } from '@/components/dashboard/risk-table'
import { WorkQueuePanel } from '@/components/dashboard/work-queue-panel'
import { CareTeamOnly } from '@/components/auth/care-team-only'

function DashboardContent() {
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading, token } = useAuth()

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [adherence, setAdherence] = useState<DashboardAdherence | null>(null)
  const [riskPatients, setRiskPatients] = useState<AtRiskPatient[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const districtParam = searchParams.get('district') || undefined
  const diseaseParam = searchParams.get('disease') || undefined
  const fromParam = searchParams.get('from') || undefined
  const toParam = searchParams.get('to') || undefined
  const escalationStatusParam = searchParams.get('escalationStatus') || undefined

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        const filter: DashboardFilterInput = {
          district: districtParam,
          disease: diseaseParam,
          from: fromParam,
          to: toParam,
          escalationStatus: escalationStatusParam,
        }

        const [sumRes, adhRes, riskRes] = await Promise.all([
          getDashboardSummary(filter),
          getDashboardAdherence(filter),
          getDashboardRiskPatients(filter),
        ])

        if (!isCancelled) {
          setSummary(sumRes)
          setAdherence(adhRes)
          setRiskPatients(riskRes)
          setErrorMessage(null)
          setIsLoading(false)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Gagal memuat data dashboard. Periksa koneksi API atau token otorisasi.',
          )
          setIsLoading(false)
        }
      }
    }

    void fetchData()

    return () => {
      isCancelled = true
    }
  }, [districtParam, diseaseParam, fromParam, toParam, escalationStatusParam, reloadKey, token])

  return (
    <>
      <PageHeader
        title="Ringkasan Monitoring"
        description="Kepatuhan obat, risiko pasien, dan kegawatdaruratan dalam satu layar."
        className="sm:items-start"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {errorMessage ? (
              <Button
                variant="outline"
                onClick={() => {
                  setIsLoading(true)
                  setReloadKey((k) => k + 1)
                }}
              >
                <RefreshCwIcon aria-hidden="true" />
                Muat ulang
              </Button>
            ) : null}
            <div data-dash="account" className="w-full sm:w-72">
              <AccountCard />
            </div>
          </div>
        }
      />

      {!authLoading && !isAuthenticated ? (
        <Alert variant="warning" icon={<TriangleAlertIcon />}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>Masuk sebagai petugas Nakes/Admin untuk melihat data ter-scope.</p>
            <Button asChild size="sm">
              <Link href="/login">
                <LogInIcon aria-hidden="true" />
                Masuk sekarang
              </Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {errorMessage}
        </Alert>
      ) : null}

      <FilterTabs isLoading={isLoading} />

      {/*
        Kolom utama membaca urut dari umum ke rinci: kondisi kepatuhan (hero),
        lalu rincian per penyakit, lalu grafik tren. Kolom kanan — angka
        pembuka dan darurat — dipin agar tetap terlihat sambil kolom utama
        digulir, jadi tidak ada ruang kosong yang menggantung di bawahnya.
      */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <div data-dash="hero"><HealthHero summary={summary} /></div>

          <div data-dash="disease"><DiseaseMetersCard data={adherence} isLoading={isLoading} /></div>

          <div data-dash="trend"><AdherenceTrendCard data={adherence} isLoading={isLoading} /></div>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-4">
          <div className="sticky-cell flex flex-col gap-5">
            <div data-dash="stats"><StatStrip summary={summary} /></div>

            <div data-dash="emergency"><EmergencyCard /></div>
          </div>
        </div>

        <div className="lg:col-span-12">
          {/* Antrean kerja berada di atas tabel risiko: yang perlu dikerjakan hari ini
              lebih penting daripada yang perlu dipantau. */}
          <div data-dash="work-queue" className="mb-5">
            <WorkQueuePanel />
          </div>
        </div>

        <div className="lg:col-span-12">
          <div data-dash="risk"><RiskTable patients={riskPatients} isLoading={isLoading} /></div>
        </div>
      </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-7">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-96" />
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
            <div className="flex flex-col gap-5 lg:col-span-8">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
              <Skeleton className="h-96" />
            </div>
            <div className="flex flex-col gap-5 lg:col-span-4">
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-36" />
                ))}
              </div>
              <Skeleton className="h-56" />
            </div>
            <Skeleton className="h-80 lg:col-span-12" />
          </div>
        </div>
      }
    >
      <CareTeamOnly>
        <DashboardContent />
      </CareTeamOnly>
    </Suspense>
  )
}