import React, { useState, useEffect, useRef } from 'react'
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native'
import { BigButton } from '../components/BigButton'
import {
  respondEmergency,
  triggerEmergencyTimeout,
  EmergencyResponseData,
} from '../services/api'
import {
  getCurrentLocation,
  createGoogleMapsUrl,
  UserCoordinates,
} from '../services/location'

export interface EmergencyScreenProps {
  initialEmergencyId?: string
  initialHrBpm?: number
  initialTimeoutSec?: number
  isFromDeepLink?: boolean
  onSuccess?: (result: EmergencyResponseData) => void
}

// Dummy emergency UUID untuk keperluan demo offline/smoke test
const DEFAULT_EMERGENCY_ID = '22222222-2222-4222-8222-222222222222'
const EMERGENCY_PHONE = 'tel:112'
const DEFAULT_TIMEOUT_SEC = 45

export function EmergencyScreen({
  initialEmergencyId,
  initialHrBpm = 145,
  initialTimeoutSec = DEFAULT_TIMEOUT_SEC,
  isFromDeepLink = false,
  onSuccess,
}: EmergencyScreenProps) {
  const [emergencyId, setEmergencyId] = useState<string>(
    initialEmergencyId || DEFAULT_EMERGENCY_ID
  )
  const [status, setStatus] = useState<
    'PENDING_CONFIRMATION' | 'LOADING' | 'RESOLVED_SAFE' | 'ESCALATED' | 'ERROR'
  >('PENDING_CONFIRMATION')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [secondsRemaining, setSecondsRemaining] = useState<number>(initialTimeoutSec)
  const [location, setLocation] = useState<UserCoordinates | null>(null)
  const [isLocating, setIsLocating] = useState<boolean>(true)
  const [resolvedTime, setResolvedTime] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 1. Ambil izin & koordinat GPS terakhir pasien saat layar terbuka (CL-213 / AC-4.3)
  useEffect(() => {
    let isMounted = true

    async function fetchLocation() {
      setIsLocating(true)
      try {
        const coords = await getCurrentLocation()
        if (isMounted) {
          setLocation(coords)
        }
      } catch (err) {
        console.warn('Gagal membaca koordinat GPS:', err)
      } finally {
        if (isMounted) {
          setIsLocating(false)
        }
      }
    }

    void fetchLocation()

    return () => {
      isMounted = false
    }
  }, [])

  // 2. Countdown timer 30–60 detik untuk konfirmasi darurat pasien (FR-4.3, AC-4.3)
  useEffect(() => {
    if (status !== 'PENDING_CONFIRMATION') {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          // Timeout tercapai -> transisi ke state ESCALATED
          handleTimeout()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [status])

  // Handler saat batas waktu konfirmasi habis (TIMEOUT)
  const handleTimeout = async () => {
    setStatus('ESCALATED')
    try {
      // Picu timeout ke backend untuk mengirim alert ke keluarga & nakes
      await triggerEmergencyTimeout(emergencyId, 'Timeout 45s: Pasien tidak merespons konfirmasi mobile')
    } catch (err) {
      console.warn('Pemberitahuan timeout backend:', err)
    }
  }

  // 3. Pasien memilih respons "Saya Aman" (SAFE) (AC-4.2)
  const handleSafe = async () => {
    setStatus('LOADING')
    setErrorMessage(null)

    try {
      const result = await respondEmergency(
        emergencyId,
        'SAFE',
        location,
        'Pasien mengonfirmasi kondisi aman dari aplikasi mobile'
      )

      setStatus('RESOLVED_SAFE')
      setResolvedTime(
        result.patientConfirmedAt
          ? new Date(result.patientConfirmedAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }) + ' WIB'
          : 'Baru saja'
      )

      if (onSuccess) {
        onSuccess(result)
      }
    } catch (err: unknown) {
      setStatus('ERROR')
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal menghubungi server untuk verifikasi kondisi aman.'
      )
    }
  }

  // 4. Pasien memilih respons "Saya Butuh Bantuan" (NEED_HELP) (AC-4.5, CL-205)
  const handleNeedHelp = async () => {
    setStatus('LOADING')
    setErrorMessage(null)

    try {
      const result = await respondEmergency(
        emergencyId,
        'NEED_HELP',
        location,
        'Pasien menekan tombol Butuh Bantuan Segera di aplikasi mobile'
      )

      setStatus('ESCALATED')
      if (onSuccess) {
        onSuccess(result)
      }
    } catch (err: unknown) {
      setStatus('ERROR')
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal mengirim sinyal darurat ke server.'
      )
    }
  }

  // 5. Panggilan Darurat 112 (MANUAL, BUKAN AUTO-DIAL — Hard Constraint #1 & AC-4.6)
  const handleCall112 = () => {
    Linking.openURL(EMERGENCY_PHONE).catch((err) => {
      console.warn('Tidak dapat membuka dialer 112:', err)
    })
  }

  // Manual refresh GPS jika pasien ingin mencoba sinkronisasi ulang
  const handleRefreshLocation = async () => {
    setIsLocating(true)
    const coords = await getCurrentLocation()
    setLocation(coords)
    setIsLocating(false)
  }

  // Reset demo simulator
  const handleResetDemo = () => {
    setStatus('PENDING_CONFIRMATION')
    setSecondsRemaining(initialTimeoutSec)
    setErrorMessage(null)
    setResolvedTime(null)
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header Aplikasi Darurat */}
      <View style={styles.header}>
        <View style={styles.emergencyBadge}>
          <Text style={styles.emergencyBadgeText}>🚨 DARURAT MEDIS</Text>
        </View>
        <Text style={styles.title}>CareLoop</Text>
        <Text style={styles.subtitle}>Sistem Respon &amp; Perlindungan Pasien</Text>
      </View>

      {/* Banner info jika dibuka dari Deep Link */}
      {isFromDeepLink && (
        <View style={styles.deepLinkBanner}>
          <Text style={styles.deepLinkText}>
            🔗 Terbuka dari notifikasi anomali smartwatch / WhatsApp
          </Text>
        </View>
      )}

      {/* KARTU STATUS ANOMALI DETAK JANTUNG */}
      <View
        style={[
          styles.card,
          status === 'ESCALATED' ? styles.cardAlert : styles.cardDefault,
        ]}
      >
        <View style={styles.pulseRow}>
          <Text style={styles.pulseIcon}>💓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardHeaderTitle}>
              Anomali Detak Jantung Terdeteksi
            </Text>
            <Text style={styles.hrValueText}>
              {initialHrBpm} <Text style={styles.bpmUnit}>BPM (Tinggi)</Text>
            </Text>
          </View>
        </View>

        <Text style={styles.cardExplanation}>
          Sensor smartwatch mendeteksi lonjakan detak jantung yang melebihi ambang batas normal pasien kronis.
        </Text>

        {/* Informasi Status Lokasi GPS (AC-4.3) */}
        <View style={styles.locationContainer}>
          <View style={styles.locationHeaderRow}>
            <Text style={styles.locationTitle}>📍 Lokasi GPS Pasien:</Text>
            <TouchableOpacity
              onPress={handleRefreshLocation}
              disabled={isLocating}
              style={styles.refreshLocButton}
            >
              <Text style={styles.refreshLocText}>
                {isLocating ? 'Mencari...' : '🔄 Segarkan GPS'}
              </Text>
            </TouchableOpacity>
          </View>

          {location ? (
            <View style={styles.locationDetails}>
              <Text style={styles.locationCoords}>
                {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                {location.accuracyM ? ` (±${location.accuracyM}m)` : ''}
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL(createGoogleMapsUrl(location.lat, location.lng))}
              >
                <Text style={styles.mapsLink}>Buka di Google Maps ↗</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.locationFallback}>
              {isLocating
                ? 'Sedang mencari koordinat GPS...'
                : 'Lokasi tidak tersedia (Izin GPS belum aktif)'}
            </Text>
          )}
        </View>
      </View>

      {/* STATE 1: PENDING CONFIRMATION DENGAN COUNTDOWN TIMER */}
      {status === 'PENDING_CONFIRMATION' && (
        <View style={styles.confirmSection}>
          <View style={styles.timerBadge}>
            <Text style={styles.timerLabel}>Sisa Waktu Konfirmasi:</Text>
            <Text style={styles.timerSeconds}>{secondsRemaining} detik</Text>
          </View>

          {/* Progress Bar Visual Countdown */}
          <View style={styles.progressBarBackground}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.max(
                    0,
                    Math.min(100, (secondsRemaining / initialTimeoutSec) * 100)
                  )}%`,
                },
              ]}
            />
          </View>

          <Text style={styles.questionText}>Apakah Anda merasa aman saat ini?</Text>

          <View style={styles.buttonStack}>
            <BigButton
              label="🟢 Saya Aman"
              color="#16A34A"
              onPress={handleSafe}
              accessibilityHint="Tekan untuk konfirmasi Anda baik-baik saja dan batalkan eskalasi"
            />

            <BigButton
              label="🆘 Saya Butuh Bantuan"
              color="#EA580C"
              onPress={handleNeedHelp}
              accessibilityHint="Tekan untuk mempercepat pengiriman bantuan ke keluarga dan nakes"
            />
          </View>

          <Text style={styles.subtext}>
            Bila tidak ada respons dalam {initialTimeoutSec} detik, sistem otomatis mengeskalasikan kondisi ke kontak darurat keluarga &amp; nakes.
          </Text>
        </View>
      )}

      {/* STATE 2: LOADING */}
      {status === 'LOADING' && (
        <View style={styles.loadingBanner}>
          <Text style={styles.loadingText}>⏳ Memproses respons keselamatan Anda...</Text>
        </View>
      )}

      {/* STATE 3: RESOLVED SAFE */}
      {status === 'RESOLVED_SAFE' && (
        <View style={styles.safeResultBanner}>
          <Text style={styles.safeTitle}>✅ Kondisi Aman Terkonfirmasi!</Text>
          <Text style={styles.safeDesc}>
            Terima kasih telah merespons ({resolvedTime}). Eskalasi darurat ke keluarga dan tenaga medis telah dibatalkan secara otomatis.
          </Text>
          <View style={{ marginTop: 12 }}>
            <TouchableOpacity onPress={handleResetDemo} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>Ulangi Simulasi Demo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* STATE 4: ESCALATED / TIMEOUT */}
      {status === 'ESCALATED' && (
        <View style={styles.escalatedBanner}>
          <Text style={styles.escalatedTitle}>⚠️ Peringatan Darurat Terkirim!</Text>
          <Text style={styles.escalatedDesc}>
            Waktu konfirmasi habis atau bantuan diminta. Notifikasi darurat dan koordinat lokasi telah diteruskan ke keluarga dan fasilitas kesehatan.
          </Text>

          {/* TOMBOL PANGGIL 112 (ONE-TAP MANUAL CALL — AC-4.6, BUKAN AUTO-DIAL) */}
          <View style={styles.callSection}>
            <BigButton
              label="📞 Panggil 112 (Ambulans/Polisi)"
              color="#DC2626"
              onPress={handleCall112}
              style={styles.emergencyCallButton}
              accessibilityHint="Panggilan manual ke nomor darurat 112"
            />
            <Text style={styles.callExplanation}>
              🔒 Tombol 112 adalah panggilan manual satu-sentuhan (one-tap call). Sistem tidak pernah memulai panggilan telepon secara otomatis.
            </Text>
          </View>

          <View style={{ marginTop: 16 }}>
            <TouchableOpacity onPress={handleResetDemo} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>Ulangi Simulasi Demo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* STATE 5: ERROR */}
      {status === 'ERROR' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>❌ Gagal Mengirim Respons</Text>
          <Text style={styles.errorDesc}>{errorMessage}</Text>
          <View style={{ marginTop: 12, gap: 8 }}>
            <BigButton label="Coba Lagi" color="#4B5563" onPress={handleSafe} />
            <BigButton
              label="📞 Panggil 112"
              color="#DC2626"
              onPress={handleCall112}
            />
          </View>
        </View>
      )}

      <Text style={styles.footerNote}>
        ID Insiden Darurat: {emergencyId}
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#FAFAF9',
    padding: 20,
    justifyContent: 'center',
    gap: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 4,
  },
  emergencyBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F87171',
    marginBottom: 6,
  },
  emergencyBadgeText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1C1917',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#78716C',
    marginTop: 2,
  },
  deepLinkBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  deepLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D4ED8',
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 18,
    borderWidth: 1.5,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  cardDefault: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E7E5E4',
  },
  cardAlert: {
    backgroundColor: '#FFF1F2',
    borderColor: '#F43F5E',
  },
  pulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pulseIcon: {
    fontSize: 36,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#78716C',
    textTransform: 'uppercase',
  },
  hrValueText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#E11D48',
  },
  bpmUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: '#BE123C',
  },
  cardExplanation: {
    fontSize: 14,
    color: '#44403C',
    lineHeight: 20,
  },
  locationContainer: {
    backgroundColor: '#F5F5F4',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#44403C',
  },
  refreshLocButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  refreshLocText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  locationDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  locationCoords: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '700',
    color: '#1C1917',
  },
  mapsLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
    textDecorationLine: 'underline',
  },
  locationFallback: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#78716C',
  },
  confirmSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    alignItems: 'center',
    gap: 14,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  timerLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#92400E',
  },
  timerSeconds: {
    fontSize: 18,
    fontWeight: '900',
    color: '#B45309',
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 4,
  },
  questionText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1917',
    textAlign: 'center',
    marginTop: 4,
  },
  buttonStack: {
    width: '100%',
    gap: 12,
  },
  subtext: {
    fontSize: 12,
    color: '#78716C',
    textAlign: 'center',
    lineHeight: 18,
  },
  loadingBanner: {
    backgroundColor: '#E0F2FE',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0369A1',
  },
  safeResultBanner: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
    borderWidth: 2,
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  safeTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#14532D',
  },
  safeDesc: {
    fontSize: 15,
    color: '#166534',
    lineHeight: 22,
  },
  escalatedBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
    borderWidth: 2,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  escalatedTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#991B1B',
  },
  escalatedDesc: {
    fontSize: 15,
    color: '#B91C1C',
    lineHeight: 22,
  },
  callSection: {
    marginTop: 8,
    gap: 8,
  },
  emergencyCallButton: {
    minHeight: 64,
  },
  callExplanation: {
    fontSize: 12,
    color: '#7F1D1D',
    textAlign: 'center',
    lineHeight: 16,
  },
  resetButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#991B1B',
  },
  errorDesc: {
    fontSize: 14,
    color: '#B91C1C',
  },
  footerNote: {
    fontSize: 11,
    color: '#A8A29E',
    textAlign: 'center',
    marginTop: 4,
  },
})
