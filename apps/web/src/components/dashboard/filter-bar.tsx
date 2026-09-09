'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DashboardFilterInput } from '@careloop/shared'

export function FilterBar({
  onFilterChange,
  isLoading,
}: {
  onFilterChange?: (filter: DashboardFilterInput) => void
  isLoading?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [district, setDistrict] = useState(() => searchParams.get('district') || '')
  const [disease, setDisease] = useState(() => searchParams.get('disease') || '')
  const [from, setFrom] = useState(() => searchParams.get('from') || '')
  const [to, setTo] = useState(() => searchParams.get('to') || '')
  const [escalationStatus, setEscalationStatus] = useState(
    () => searchParams.get('escalationStatus') || '',
  )

  const applyFilters = (custom?: Partial<DashboardFilterInput>) => {
    const params = new URLSearchParams()

    const d = custom?.district !== undefined ? custom.district : district
    const dis = custom?.disease !== undefined ? custom.disease : disease
    const f = custom?.from !== undefined ? custom.from : from
    const t = custom?.to !== undefined ? custom.to : to
    const esc = custom?.escalationStatus !== undefined ? custom.escalationStatus : escalationStatus

    if (d && d.trim()) params.set('district', d.trim())
    if (dis && dis.trim()) params.set('disease', dis.trim())
    if (f && f.trim()) params.set('from', f.trim())
    if (t && t.trim()) params.set('to', t.trim())
    if (esc && esc.trim()) params.set('escalationStatus', esc.trim())

    const query = params.toString()
    router.push(query ? `/dashboard?${query}` : '/dashboard')

    if (onFilterChange) {
      onFilterChange({
        district: d || undefined,
        disease: dis || undefined,
        from: f || undefined,
        to: t || undefined,
        escalationStatus: esc || undefined,
      })
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    applyFilters()
  }

  const handleReset = () => {
    setDistrict('')
    setDisease('')
    setFrom('')
    setTo('')
    setEscalationStatus('')
    router.push('/dashboard')
    if (onFilterChange) {
      onFilterChange({})
    }
  }

  const hasActiveFilters = Boolean(district || disease || from || to || escalationStatus)

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
            </span>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              Filter Data Monitoring (AC-5.2)
            </h3>
          </div>
          {hasActiveFilters && (
            <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-medium dark:bg-emerald-950/40 dark:text-emerald-300">
              Filter aktif tersimpan di URL (bisa di-bookmark)
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Wilayah / Distrik */}
          <div>
            <label htmlFor="filter-district" className="block text-xs font-medium text-zinc-500 mb-1 dark:text-zinc-400">
              Kode Wilayah / Distrik
            </label>
            <input
              id="filter-district"
              type="text"
              placeholder="Contoh: 347101"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            />
          </div>

          {/* Jenis Penyakit */}
          <div>
            <label htmlFor="filter-disease" className="block text-xs font-medium text-zinc-500 mb-1 dark:text-zinc-400">
              Jenis Penyakit
            </label>
            <select
              id="filter-disease"
              value={disease}
              onChange={(e) => setDisease(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            >
              <option value="">Semua Penyakit</option>
              <option value="DIABETES">Diabetes Melitus</option>
              <option value="HYPERTENSION">Hipertensi</option>
              <option value="JANTUNG">Penyakit Jantung</option>
              <option value="ASMA">Asma</option>
            </select>
          </div>

          {/* Dari Tanggal */}
          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-zinc-500 mb-1 dark:text-zinc-400">
              Dari Tanggal
            </label>
            <input
              id="filter-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            />
          </div>

          {/* Sampai Tanggal */}
          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-zinc-500 mb-1 dark:text-zinc-400">
              Sampai Tanggal
            </label>
            <input
              id="filter-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            />
          </div>

          {/* Status Eskalasi */}
          <div>
            <label htmlFor="filter-escalation" className="block text-xs font-medium text-zinc-500 mb-1 dark:text-zinc-400">
              Status Eskalasi
            </label>
            <select
              id="filter-escalation"
              value={escalationStatus}
              onChange={(e) => setEscalationStatus(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            >
              <option value="">Semua Status</option>
              <option value="WAITING_PATIENT">Menunggu Pasien</option>
              <option value="FAMILY_TIER_1">Tier 1 (Keluarga Dekat)</option>
              <option value="FAMILY_TIER_2">Tier 2 (Keluarga Jauh)</option>
              <option value="NAKES">Tier 3 (Nakes / Faskes)</option>
              <option value="HANDLED">Sudah Ditangani</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>Filter Cepat:</span>
            <button
              type="button"
              onClick={() => {
                setDisease('DIABETES')
                applyFilters({ disease: 'DIABETES' })
              }}
              className="rounded-lg bg-zinc-100 px-2 py-1 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              Diabetes
            </button>
            <button
              type="button"
              onClick={() => {
                setDisease('HYPERTENSION')
                applyFilters({ disease: 'HYPERTENSION' })
              }}
              className="rounded-lg bg-zinc-100 px-2 py-1 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              Hipertensi
            </button>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isLoading}
                className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Reset Filter
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isLoading && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              Terapkan Filter
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
