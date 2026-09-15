'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { DashboardFilterInput } from '@careloop/shared'
import {
  getDashboardSummary,
  getDashboardAdherence,
  getDashboardRiskPatients,
  type DashboardSummary,
  type DashboardAdherence,
  type AtRiskPatient,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { KpiCards } from '../../components/dashboard/kpi-cards'
import { AdherenceChart } from '../../components/dashboard/adherence-chart'
import { RiskTable } from '../../components/dashboard/risk-table'
import { FilterBar } from '../../components/dashboard/filter-bar'
import { EmergencyPanel } from '../../components/dashboard/emergency-panel'

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
          const msg =
            err instanceof Error
              ? err.message
              : 'Gagal memuat data dashboard. Periksa koneksi API atau token otorisasi.'
          setErrorMessage(msg)
          setIsLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      isCancelled = true
    }
  }, [districtParam, diseaseParam, fromParam, toParam, escalationStatusParam, reloadKey, token])

  return (
    <div className="space-y-6">
      {/* Notifikasi Belum Login */}
      {!authLoading && !isAuthenticated && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <p className="text-sm font-medium">
              Anda belum masuk sebagai petugas Nakes/Admin. Anda dapat masuk untuk mengakses data ter-scope.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl bg-amber-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Masuk Sekarang
          </Link>
        </div>
      )}

      {/* Panel Peringatan Darurat Medis Real-Time (CL-212, AC-4.3, AC-4.5) */}
      <EmergencyPanel />

      {/* Filter Bar (FR-5.2, AC-5.2 bookmarkable) */}
      <FilterBar
        key={`${districtParam || ''}-${diseaseParam || ''}-${fromParam || ''}-${toParam || ''}-${escalationStatusParam || ''}`}
        isLoading={isLoading}
      />

      {/* Tampilan Error */}
      {errorMessage && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/40">
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-300 mb-1">
            Terjadi Kesalahan
          </p>
          <p className="text-xs text-rose-600 dark:text-rose-400 mb-4 max-w-md mx-auto">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true)
              setReloadKey((k) => k + 1)
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* 1. Ringkasan KPI Cards */}
      <KpiCards summary={summary} isLoading={isLoading} />

      {/* 2. Grafik Tren Deret Waktu & Distribusi Penyakit */}
      <AdherenceChart data={adherence} isLoading={isLoading} />

      {/* 3. Tabel Daftar Pasien Berisiko Tinggi */}
      <RiskTable patients={riskPatients} isLoading={isLoading} />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-32 w-full animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
