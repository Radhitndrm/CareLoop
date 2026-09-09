'use client'

import { useState } from 'react'
import { useEmergencyAlerts, type EmergencyAlertItem } from '../../hooks/use-emergency-alerts'

export function EmergencyPanel() {
  const {
    alerts,
    activeAlerts,
    isConnected,
    isLoading,
    handlingAlertId,
    handleEmergency,
    refreshAlerts,
  } = useEmergencyAlerts()

  const [handlingSuccessId, setHandlingSuccessId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onHandleClick = async (alert: EmergencyAlertItem) => {
    setErrorMessage(null)
    try {
      await handleEmergency(alert)
      setHandlingSuccessId(alert.id)
      setTimeout(() => setHandlingSuccessId(null), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim respons penanganan'
      setErrorMessage(msg)
    }
  }

  const formatWibTime = (isoString: string) => {
    try {
      const date = new Date(isoString)
      return date.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Jakarta',
      }) + ' WIB'
    } catch {
      return isoString
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      {/* Panel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                Panel Peringatan Darurat Medis
              </h3>
              {activeAlerts.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white animate-pulse">
                  {activeAlerts.length} Aktif
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Notifikasi real-time anomali detak jantung &amp; eskalasi pasien
            </p>
          </div>
        </div>

        {/* Real-Time WebSocket Status Indicator (CL-208) & Refresh button */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isConnected ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
              }`}
            />
            {isConnected ? 'Real-Time Aktif (WebSocket)' : 'Menghubungkan WS...'}
          </span>
          <button
            type="button"
            onClick={() => refreshAlerts()}
            disabled={isLoading}
            title="Segarkan data alert"
            className="rounded-xl border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <svg
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMessage}
        </div>
      )}

      {/* List Alert atau Empty State */}
      <div className="mt-4 space-y-3">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 mb-2">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <p className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">
              Tidak Ada Peringatan Darurat Aktif
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-sm">
              Seluruh pasien binaan dalam kondisi stabil. Sistem siaga memantau data detak jantung smartwatch secara real-time.
            </p>
          </div>
        ) : (
          alerts.map((alert) => {
            const isHandling = handlingAlertId === alert.id
            const isHandled = alert.isHandled || alert.status === 'HANDLED'
            const isAlone = alert.livingSituation === 'ALONE'

            return (
              <div
                key={alert.id}
                className={`rounded-xl border p-4 transition-all ${
                  isHandled
                    ? 'border-zinc-200 bg-zinc-50/60 opacity-75 dark:border-zinc-800 dark:bg-zinc-900/30'
                    : 'border-2 border-rose-400 bg-rose-50/70 dark:border-rose-900/80 dark:bg-rose-950/20 shadow-xs'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  {/* Info Pasien & Detail Anomali */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                        {alert.patientName}
                      </span>
                      {isAlone && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                          Tinggal Sendiri (Alone)
                        </span>
                      )}
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatWibTime(alert.triggeredAt)}
                      </span>
                      {alert.districtCode && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          Distrik {alert.districtCode}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-400">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                        {alert.triggerType === 'ANOMALY_HR'
                          ? `Anomali Detak Jantung Tinggi${alert.hrBpm ? ` (${alert.hrBpm} bpm)` : ''}`
                          : alert.triggerType}
                      </span>

                      {/* Lokasi GPS Pasien (AC-4.3) */}
                      {alert.location && alert.location.lat && alert.location.lng ? (
                        <a
                          href={`https://www.google.com/maps?q=${alert.location.lat},${alert.location.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium underline underline-offset-2"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          Buka di Google Maps ({alert.location.lat.toFixed(4)}, {alert.location.lng.toFixed(4)})
                        </a>
                      ) : (
                        <span className="text-zinc-400 italic">
                          📍 Lokasi tidak tersedia
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tombol Aksi: "Saya Tangani" (AC-4.5, CL-207) */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isHandled ? (
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3.5 py-2 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                        <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        Sudah Ditangani (HANDLED)
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isHandling}
                        onClick={() => onHandleClick(alert)}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
                      >
                        {isHandling ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            Memproses...
                          </>
                        ) : (
                          <>
                            <span>🩺</span>
                            Saya Tangani
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {handlingSuccessId === alert.id && (
                  <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    ✓ Status berhasil diubah menjadi HANDLED. Eskalasi darurat telah dihentikan.
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
