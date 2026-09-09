'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
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
      const message = err instanceof Error ? err.message : 'Gagal masuk. Periksa nomor HP / email dan kata sandi Anda.'
      setErrorMsg(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fillDemo = (id: string, pass: string) => {
    setIdentifier(id)
    setPassword(pass)
    setErrorMsg('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4 font-sans dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20 mb-3">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            CareLoop Nakes
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Masuk ke portal dashboard pemantauan kepatuhan & darurat
          </p>
        </div>

        {errorMsg && (
          <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="identifier"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              Nomor HP atau Email
            </label>
            <input
              id="identifier"
              type="text"
              required
              placeholder="Contoh: 081200000001 atau dokter@careloop.id"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              Kata Sandi
            </label>
            <input
              id="password"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-sm text-zinc-900 focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-100"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            Masuk ke Dashboard
          </button>
        </form>

        {/* Quick Demo Fill Buttons */}
        <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 text-center">
            Demo Hackathon — Isi Cepat
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fillDemo('081200000001', 'password123')}
              className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300"
            >
              🩺 Dokter Puskesmas
            </button>
            <button
              type="button"
              onClick={() => fillDemo('admin@careloop.id', 'password123')}
              className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300"
            >
              🏛️ Admin Dinkes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
