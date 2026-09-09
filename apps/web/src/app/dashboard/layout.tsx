'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../../lib/auth'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { user, isAuthenticated, logout, isLoading } = useAuth()

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Brand Logo */}
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/30">
                  <svg
                    className="h-6 w-6"
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
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                      CareLoop
                    </span>
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      NAKES
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">Monitoring Kepatuhan &amp; Darurat</p>
                </div>
              </Link>

              <nav className="hidden md:flex items-center gap-1">
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  Ringkasan Monitoring
                </Link>
              </nav>
            </div>

            {/* User Profile & Actions */}
            <div className="flex items-center gap-3">
              {!isLoading && (
                <>
                  {isAuthenticated && user ? (
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {user.fullName || 'Nakes Petugas'}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {user.role === 'ADMIN' ? 'Administrator Dinkes' : 'Petugas Nakes / Kader'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Keluar
                      </button>
                    </div>
                  ) : (
                    <Link
                      href="/login"
                      className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Masuk Nakes
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      <footer className="border-t border-zinc-200 bg-white py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        CareLoop — Ekosistem Kepatuhan Pengobatan &amp; Deteksi Darurat (SDG 3 Digital Health). Data sintetis demo.
      </footer>
    </div>
  )
}
