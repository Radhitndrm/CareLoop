'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { type ApiUser, loginApi, setStoredToken, setStoredUser } from './api'

export interface AuthContextType {
  user: ApiUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const TOKEN_KEY = 'careloop_token'
const USER_KEY = 'careloop_user'

/** Snapshot disimpan sebagai string, bukan objek: useSyncExternalStore
 * membandingkan dengan Object.is, sehingga objek baru tiap baca akan memicu
 * render tanpa henti. */
interface AuthSnapshot {
  token: string | null
  user: ApiUser | null
}

let snapshot: AuthSnapshot = { token: null, user: null }
const listeners = new Set<() => void>()

/**
 * Cache hasil parsing `careloop_user` berdasarkan string mentahnya.
 *
 * `getStoredUser()` di api.ts memanggil `JSON.parse` setiap kali, sehingga
 * objek user yang dikembalikan selalu berbeda identitasnya. Kalau snapshot
 * membandingkan `user` dengan Object.is, hasilnya tidak pernah sama dan
 * React mengulang render terus-menerus. Dengan membandingkan string mentah
 * lebih dulu, parse hanya terjadi saat isinya benar-benar berubah.
 */
let cachedUserRaw: string | null = null
let cachedUser: ApiUser | null = null

function readStoredUser(): ApiUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (raw === cachedUserRaw) return cachedUser
  if (raw === null) {
    cachedUserRaw = null
    cachedUser = null
    return null
  }
  try {
    cachedUserRaw = raw
    cachedUser = JSON.parse(raw) as ApiUser
  } catch {
    cachedUserRaw = raw
    cachedUser = null
  }
  return cachedUser
}

/**
 * Baca penyimpanan dan kembalikan snapshot baru **hanya bila isinya berubah**.
 *
 * Penting: `getSnapshot` dipanggil pada setiap render, bukan hanya saat ada
 * perubahan. Kalau selalu mengembalikan objek baru, React melihat nilai
 * berbeda tiap kali (Object.is) lalu memicu render lagi — loop tak berujung.
 * Karena itu objek yang sama dikembalikan selama token & user tidak berubah.
 */
function readStorage(): AuthSnapshot {
  const token = localStorage.getItem(TOKEN_KEY)
  const user = readStoredUser()

  if (snapshot.token === token && snapshot.user === user) {
    return snapshot
  }

  snapshot = { token, user }
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Penyimpanan token bisa diubah tab lain (mis. logout di tab berbeda).
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * Snapshot server WAJIB berupa objek konstan dengan identitas stabil.
 * `useSyncExternalStore` membandingkan hasil tiap panggilan dengan Object.is;
 * kalau `getServerSnapshot` membuat objek baru setiap dipanggil, perbandingan
 * selalu "berbeda" dan React mengulang render tanpa henti.
 */
const SERVER_SNAPSHOT: AuthSnapshot = { token: null, user: null }

function getServerSnapshot(): AuthSnapshot {
  return SERVER_SNAPSHOT
}

function emitChange() {
  readStorage()
  for (const listener of listeners) listener()
}

/**
 * Baca token & user dari localStorage.
 *
 * `useSyncExternalStore` dipakai, bukan `useState` + `useEffect`: server tidak
 * punya localStorage sehingga snapshot-nya null, sementara render pertama di
 * client harus sudah berisi nilai sebenarnya. Kalau state diisi lewat effect,
 * render pertama client akan cocok dengan server (null) lalu berubah setelahnya
 * — persis pola yang memicu hydration mismatch (AGENTS.md: server/client harus
 * menghasilkan HTML yang sama).
 */
function useStoredAuth() {
  return useSyncExternalStore(subscribe, readStorage, getServerSnapshot)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { token: storedToken, user: storedUser } = useStoredAuth()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const login = useCallback(async (identifier: string, password: string) => {
    setIsLoggingIn(true)
    try {
      const res = await loginApi(identifier, password)
      setStoredToken(res.accessToken)
      setStoredUser(res.user)
      // localStorage berubah di luar React, jadi cache snapshot disegarkan manual.
      emitChange()
    } finally {
      setIsLoggingIn(false)
    }
  }, [])

  const logout = useCallback(() => {
    setStoredToken(null)
    setStoredUser(null)
    emitChange()
  }, [])

  const value = useMemo<AuthContextType>(
    () => ({
      user: storedUser,
      token: storedToken,
      isAuthenticated: Boolean(storedToken && storedUser),
      isLoading: isLoggingIn,
      login,
      logout,
    }),
    [storedUser, storedToken, isLoggingIn, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth harus digunakan di dalam AuthProvider')
  }
  return context
}

export { TOKEN_KEY, USER_KEY }