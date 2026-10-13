import React, { useState, useEffect, useRef } from 'react'
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
} from 'react-native'
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  HeartPulseIcon,
  LinkIcon,
  MapPinIcon,
  PhoneCallIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SirenIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { BigButton } from '../components/BigButton'
import { Card } from '../components/Card'
import { IconWell, ProgressBar, Spinner, StatusBadge } from '../components/feedback'
import { colors, radius, spacing, typography } from '../theme/tokens'
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

const EMERGENCY_PHONE = 'tel:112'
const DEFAULT_TIMEOUT_SEC = 45

type Status = 'PENDING_CONFIRMATION' | 'LOADING' | 'RESOLVED_SAFE' | 'ESCALATED' | 'ERROR'

export function EmergencyScreen({
  initialEmergencyId,
  initialHrBpm = 145,
  initialTimeoutSec = DEFAULT_TIMEOUT_SEC,
  isFromDeepLink = false,
  onSuccess,
}: EmergencyScreenProps) {
  // Tidak ada UUID dummy: incident selalu datang dari server atau deep link resmi.
  // Tanpa ID yang valid, layar ini menampilkan instruksi, bukan tombol aksi palsu.
  const [emergencyId, setEmergencyId] = useState<string>(initialEmergencyId ?? '')
  const [status, setStatus] = useState<Status>('PENDING_CONFIRMATION')
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
          void handleTimeout()
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
        err instanceof Error ? err.message : 'Gagal mengirim sinyal darurat ke server.'
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
      <View style={styles.header}>
        <StatusBadge
          label="Darurat medis"
          tone="danger"
          icon={<SirenIcon size={14} color={colors.danger} />}
        />
        <Text style={styles.title}>Anomali detak jantung terdeteksi</Text>
        <Text style={styles.subtitle}>
          Sistem akan menghubungi keluarga dan tenaga kesehatan bila Anda tidak merespons.
        </Text>
      </View>

      {isFromDeepLink ? (
        <View style={styles.deepLinkBanner}>
          <LinkIcon size={16} color={colors.primary} />
          <Text style={styles.deepLinkText}>
            Terbuka dari notifikasi anomali smartwatch / WhatsApp
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.card,
          status === 'ESCALATED' ? styles.cardAlert : styles.cardDefault,
        ]}
      >
        <View style={styles.pulseRow}>
          <IconWell tone="danger" size={52}>
            <HeartPulseIcon size={24} color={colors.danger} />
          </IconWell>
          <View style={styles.pulseText}>
            <Text style={styles.cardHeaderTitle}>Deteksi smartwatch</Text>
            <Text style={styles.hrValue}>
              {initialHrBpm} <Text style={styles.bpmUnit}>BPM</Text>
            </Text>
          </View>
        </View>

        <Text style={styles.cardExplanation}>
          Sensor smartwatch mendeteksi lonjakan detak jantung yang melebihi ambang batas normal
          pasien kronis.
        </Text>

        <View style={styles.locationContainer}>
          <View style={styles.locationHeaderRow}>
            <Text style={styles.locationTitle}>
              <MapPinIcon size={14} color={colors.textSecondary} /> Lokasi GPS
            </Text>
            <Pressable
              onPress={handleRefreshLocation}
              disabled={isLocating}
              accessibilityRole="button"
              accessibilityLabel="Segarkan koordinat GPS"
              style={styles.refreshLocButton}
            >
              {isLocating ? (
                <Spinner size={14} color={colors.primary} />
              ) : (
                <RefreshCwIcon size={14} color={colors.primary} />
              )}
              <Text style={styles.refreshLocText}>{isLocating ? 'Mencari…' : 'Segarkan'}</Text>
            </Pressable>
          </View>

          {location ? (
            <View style={styles.locationDetails}>
              <Text style={styles.locationCoords}>
                {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                {location.accuracyM ? ` (±${location.accuracyM}m)` : ''}
              </Text>
              <Pressable
                onPress={() => Linking.openURL(createGoogleMapsUrl(location.lat, location.lng))}
                accessibilityRole="link"
              >
                <Text style={styles.mapsLink}>
                  Buka di Google Maps <ExternalLinkIcon size={13} color={colors.primary} />
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.locationFallback}>
              {isLocating
                ? 'Sedang mencari koordinat GPS…'
                : 'Lokasi tidak tersedia (izin GPS belum aktif)'}
            </Text>
          )}
        </View>
      </View>

      {status === 'PENDING_CONFIRMATION' ? (
        <Card>
          <StatusBadge
            label={`Sisa waktu konfirmasi: ${secondsRemaining} detik`}
            tone={secondsRemaining <= 15 ? 'danger' : 'warning'}
          />
          <ProgressBar
            value={(secondsRemaining / initialTimeoutSec) * 100}
            tone={secondsRemaining <= 15 ? 'danger' : 'warning'}
          />
          <Text style={styles.questionText}>Apakah Anda merasa aman saat ini?</Text>

          <View style={styles.buttonStack}>
            <BigButton
              label="Saya aman"
              variant="success"
              size="lg"
              icon={<CheckCircle2Icon size={20} color={colors.textOnPrimary} />}
              onPress={handleSafe}
            />
            <BigButton
              label="Saya butuh bantuan"
              variant="danger"
              size="lg"
              icon={<ShieldAlertIcon size={20} color={colors.danger} />}
              onPress={handleNeedHelp}
            />
          </View>

          <Text style={styles.subtext}>
            Bila tidak ada respons dalam {initialTimeoutSec} detik, sistem otomatis mengeskalasikan
            kondisi ke kontak darurat keluarga &amp; nakes.
          </Text>
        </Card>
      ) : null}

      {!emergencyId ? (
        <Card>
          <Text style={styles.footerNote}>
            Tidak ada insiden darurat aktif. Layar ini akan terisi otomatis saat sistem
            mendeteksi anomali, atau saat Anda membuka tautan peringatan dari WhatsApp.
          </Text>
        </Card>
      ) : null}

      {status === 'LOADING' ? (
        <View style={styles.loadingBanner}>
          <Spinner size={18} color={colors.primary} />
          <Text style={styles.loadingText}>Memproses respons keselamatan Anda…</Text>
        </View>
      ) : null}

      {status === 'RESOLVED_SAFE' ? (
        <View style={styles.safeResultBanner}>
          <CheckCircle2Icon size={24} color={colors.success} />
          <Text style={styles.safeTitle}>Kondisi aman terkonfirmasi</Text>
          <Text style={styles.safeDesc}>
            Terima kasih telah merespons ({resolvedTime}). Eskalasi darurat ke keluarga dan tenaga
            medis dibatalkan otomatis.
          </Text>
          <BigButton
            label="Ulangi simulasi demo"
            variant="secondary"
            icon={<RotateCcwIcon size={18} color={colors.textSecondary} />}
            onPress={handleResetDemo}
          />
        </View>
      ) : null}

      {status === 'ESCALATED' ? (
        <View style={styles.escalatedBanner}>
          <TriangleAlertIcon size={24} color={colors.danger} />
          <Text style={styles.escalatedTitle}>Peringatan darurat terkirim</Text>
          <Text style={styles.escalatedDesc}>
            Waktu konfirmasi habis atau bantuan diminta. Notifikasi darurat dan koordinat lokasi
            telah diteruskan ke keluarga dan fasilitas kesehatan.
          </Text>

          {/* Tombol 112 hanya muncul pada insiden yang benar-benar aktif. Hard
              constraint: panggilan tetap manual, tidak ada auto-dial. */}
          {emergencyId ? (
            <BigButton
              label="Panggil 112 (Ambulans/Polisi)"
              variant="danger"
              size="lg"
              icon={<PhoneCallIcon size={22} color={colors.danger} />}
              onPress={handleCall112}
            />
          ) : null}
          <Text style={styles.callExplanation}>
            Tombol 112 adalah panggilan manual satu-sentuhan (one-tap call). Sistem tidak pernah
            memulai panggilan telepon secara otomatis.
          </Text>

          <BigButton
            label="Ulangi simulasi demo"
            variant="secondary"
            icon={<RotateCcwIcon size={18} color={colors.textSecondary} />}
            onPress={handleResetDemo}
          />
        </View>
      ) : null}

      {status === 'ERROR' ? (
        <View style={styles.errorBanner}>
          <TriangleAlertIcon size={22} color={colors.danger} />
          <Text style={styles.errorTitle}>Gagal mengirim respons</Text>
          <Text style={styles.errorDesc}>{errorMessage}</Text>
          <View style={styles.buttonStack}>
            <BigButton label="Coba lagi" variant="secondary" onPress={handleSafe} />
            {emergencyId ? (
              <BigButton
                label="Panggil 112"
                variant="danger"
                size="lg"
                icon={<PhoneCallIcon size={20} color={colors.danger} />}
                onPress={handleCall112}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {emergencyId ? (
        <Text style={styles.footerNote}>ID Insiden Darurat: {emergencyId}</Text>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.display,
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  deepLinkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoftest,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  deepLinkText: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.primary,
    flex: 1,
  },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    gap: spacing.md,
    ...Platform.select({
      ios: {
        shadowColor: colors.text,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  cardDefault: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
  },
  cardAlert: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.danger,
  },
  pulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pulseText: {
    flexShrink: 1,
    gap: 2,
  },
  cardHeaderTitle: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  hrValue: {
    ...typography.h1,
    fontSize: 28,
    fontWeight: '700',
    color: colors.danger,
  },
  bpmUnit: {
    ...typography.h2,
    fontSize: 16,
    color: colors.danger,
  },
  cardExplanation: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  locationContainer: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.textSecondary,
  },
  refreshLocButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  refreshLocText: {
    ...typography.bodySmall,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  locationDetails: {
    gap: spacing.xs,
  },
  locationCoords: {
    ...typography.body,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontWeight: '700',
    color: colors.text,
  },
  mapsLink: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  locationFallback: {
    ...typography.bodySmall,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  questionText: {
    ...typography.h1,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  buttonStack: {
    gap: spacing.md,
  },
  subtext: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoftest,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.primary,
  },
  safeResultBanner: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  safeTitle: {
    ...typography.h1,
    color: colors.success,
  },
  safeDesc: {
    ...typography.bodySmall,
    color: colors.success,
  },
  escalatedBanner: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  escalatedTitle: {
    ...typography.h1,
    color: colors.danger,
  },
  escalatedDesc: {
    ...typography.bodySmall,
    color: colors.danger,
  },
  callExplanation: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  errorTitle: {
    ...typography.h2,
    color: colors.danger,
  },
  errorDesc: {
    ...typography.bodySmall,
    color: colors.danger,
  },
  footerNote: {
    ...typography.bodySmall,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
})