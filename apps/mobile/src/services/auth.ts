// Penyimpanan & siklus token pasien di perangkat.
//
// Memakai `expo-secure-store` (Keychain di iOS, EncryptedSharedPreferences di
// Android) alih-alih AsyncStorage: token ini memberi akses ke rekam medis dan ke
// tombol darurat, jadi tidak layak disimpan plaintext di direktori aplikasi.
//
// **Alasan dependency baru** (AGENTS.md §2): tidak ada store aman bawaan React Native.
// AsyncStorage hanya disimpan di sandbox aplikasi dan dapat dibaca dari backup/root;
// untuk data kesehatan itu tidak dapat diterima.
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'careloop_patient_token'

let memoryToken: string | null = null
let loaded = false

export async function getStoredToken(): Promise<string | null> {
  if (memoryToken) return memoryToken
  if (loaded) return null
  try {
    memoryToken = await SecureStore.getItemAsync(TOKEN_KEY)
    loaded = true
  } catch {
    // Keychain occasionally gagal (mis. perangkat tanpa passcode). Aplikasi tetap
    // bisa dipakai tanpa menyimpan token, tapi harus login ulang tiap dibuka.
    memoryToken = null
    loaded = true
  }
  return memoryToken
}

export async function setStoredToken(token: string | null): Promise<void> {
  memoryToken = token
  loaded = true
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token)
    else await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch {
    // Kegagalan penyimpanan tidak boleh menjatuhkan login yang baru saja berhasil;
    // token tetap hidup di memori selama sesi ini.
  }
}

export async function clearStoredToken(): Promise<void> {
  await setStoredToken(null)
}

/** Header auth untuk seluruh request. `null` berarti belum login. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}