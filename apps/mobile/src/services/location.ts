import * as Location from 'expo-location'

export interface UserCoordinates {
  lat: number
  lng: number
  accuracyM?: number
}

export interface LocationState {
  permissionGranted: boolean
  coords: UserCoordinates | null
  errorMsg: string | null
}

/**
 * Meminta izin lokasi perangkat (foreground) untuk kebutuhan darurat medis (CL-213 / AC-4.3).
 */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    return status === 'granted'
  } catch (err: unknown) {
    console.warn('Gagal meminta izin lokasi:', err)
    return false
  }
}

/**
 * Mengambil koordinat GPS terakhir atau posisi terkini pasien.
 * Mengembalikan null jika izin tidak diberikan atau sinyal GPS tidak tersedia.
 */
export async function getCurrentLocation(): Promise<UserCoordinates | null> {
  try {
    const hasPermission = await requestLocationPermission()
    if (!hasPermission) {
      return null
    }

    // 1. Coba ambil lastKnownPosition untuk respon cepat
    const lastKnown = await Location.getLastKnownPositionAsync()
    if (lastKnown?.coords) {
      return {
        lat: Number(lastKnown.coords.latitude.toFixed(6)),
        lng: Number(lastKnown.coords.longitude.toFixed(6)),
        accuracyM: lastKnown.coords.accuracy ? Math.round(lastKnown.coords.accuracy) : undefined,
      }
    }

    // 2. Ambil currentPosition jika lastKnown belum tersedia
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })

    return {
      lat: Number(current.coords.latitude.toFixed(6)),
      lng: Number(current.coords.longitude.toFixed(6)),
      accuracyM: current.coords.accuracy ? Math.round(current.coords.accuracy) : undefined,
    }
  } catch (err: unknown) {
    console.warn('Gagal mengambil koordinat lokasi:', err)
    return null
  }
}

/**
 * Menghasilkan link Google Maps dari koordinat GPS.
 */
export function createGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}
