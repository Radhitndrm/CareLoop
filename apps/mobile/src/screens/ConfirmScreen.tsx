import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { CheckCircle2Icon, LinkIcon, PillIcon, TriangleAlertIcon } from 'lucide-react'
import { BigButton } from '../components/BigButton'
import { Card } from '../components/Card'
import { IconWell, StatusBadge } from '../components/feedback'
import { colors, radius, spacing, typography } from '../theme/tokens'
import {
  confirmCompliance,
  getMySchedules,
  type ComplianceConfirmResponseData,
  type OwnSchedule,
} from '../services/api'

export interface ConfirmScreenProps {
  /** Jadwal dari server. Kalau kosong, layar menampilkan daftar milik pasien sendiri. */
  schedule?: OwnSchedule | null
  initialScheduleId?: string
  isFromDeepLink?: boolean
  onSuccess?: (result: ComplianceConfirmResponseData) => void
}

export function ConfirmScreen({
  schedule,
  initialScheduleId,
  isFromDeepLink = false,
  onSuccess,
}: ConfirmScreenProps) {
  // Tidak ada lagi UUID dummy: jadwal selalu berasal dari server milik pasien yang
  // sedang login. Mengonfirmasi jadwal orang lain tidak mungkin karena ID-nya tidak
  // pernah di-hardcode di aplikasi.
  const [scheduleId, setScheduleId] = useState<string>(initialScheduleId ?? '')
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [confirmedTime, setConfirmedTime] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<OwnSchedule[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Jadwal milik pasien yang sedang login. Ganti deep link kalau ID-nya berbeda.
  const active = useMemo(
    () =>
      schedules.find((item) => item.id === scheduleId) ??
      schedule ??
      schedules[0] ??
      null,
    [schedules, scheduleId, schedule],
  )

  useEffect(() => {
    let cancelled = false

    async function fetchSchedules() {
      setIsLoading(true)
      try {
        const result = await getMySchedules()
        if (!cancelled) setSchedules(result)
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Gagal memuat jadwal obat',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchSchedules()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (initialScheduleId && initialScheduleId !== scheduleId) {
      setScheduleId(initialScheduleId)
      // Status direset karena jadwal yang dikonfirmasi memang berbeda.
      setStatus('IDLE')
      setErrorMessage(null)
      setConfirmedTime(null)
    }
  }, [initialScheduleId, scheduleId])

  const handleConfirm = async () => {
    if (!scheduleId) {
      setStatus('ERROR')
      setErrorMessage('Belum ada jadwal obat yang bisa dikonfirmasi.')
      return
    }
    setStatus('LOADING')
    setErrorMessage(null)

    try {
      const result = await confirmCompliance(scheduleId)
      setStatus('SUCCESS')
      setConfirmedTime(
        result.confirmedAt
          ? new Date(result.confirmedAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            }) + ' WIB'
          : 'Baru saja'
      )
      if (onSuccess) {
        onSuccess(result)
      }
    } catch (err: unknown) {
      setStatus('ERROR')
      if (err instanceof Error) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Gagal menghubungi server. Periksa koneksi internet.')
      }
    }
  }


  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <StatusBadge label="Jadwal obat" tone="primary" icon={<PillIcon size={14} color={colors.primary} />} />
        <Text style={styles.title}>Waktunya minum obat</Text>
        <Text style={styles.subtitle}>
          Satu ketukan untuk mengonfirmasi. Kalau tidak, caregiver akan diberi tahu.
        </Text>
      </View>

      {isFromDeepLink ? (
        <View style={styles.deepLinkBanner}>
          <LinkIcon size={16} color={colors.primary} />
          <Text style={styles.deepLinkText}>Terbuka dari tautan pengingat WhatsApp</Text>
        </View>
      ) : null}

      <Card>
        <View style={styles.medRow}>
          <IconWell tone="primary">
            <PillIcon size={20} color={colors.primary} />
          </IconWell>
          <View style={styles.medText}>
            <Text style={styles.cardLabel}>Obat</Text>
            <Text style={styles.medicationName}>{active?.medicationName ?? 'Memuat…'}</Text>
          </View>
        </View>

        <Text style={styles.instruction}>{active?.doseQty}</Text>
        {active?.instructions ? (
          <Text style={styles.instruction}>{active.instructions}</Text>
        ) : null}
        {active?.dosage ? <Text style={styles.instruction}>{active.dosage}</Text> : null}

        <StatusBadge
          label={active ? `Waktu ${active.timeOfDay}` : '—'}
          tone="neutral"
          icon={<PillIcon size={13} color={colors.neutral} />}
        />
      </Card>

      {status === 'SUCCESS' ? (
        <View style={styles.successBanner}>
          <CheckCircle2Icon size={22} color={colors.success} />
          <View style={styles.bannerText}>
            <Text style={styles.successTitle}>Obat berhasil dikonfirmasi</Text>
            <Text style={styles.successDesc}>
              Terima kasih sudah minum tepat waktu ({confirmedTime}). Eskalasi otomatis dibatalkan.
            </Text>
          </View>
        </View>
      ) : null}

      {status === 'ERROR' ? (
        <View style={styles.errorBanner}>
          <TriangleAlertIcon size={22} color={colors.danger} />
          <View style={styles.bannerText}>
            <Text style={styles.errorTitle}>Konfirmasi gagal</Text>
            <Text style={styles.errorDesc}>{errorMessage}</Text>
            <Text style={styles.retryHint}>Tekan tombol di bawah untuk mencoba kembali.</Text>
          </View>
        </View>
      ) : null}

      {!isLoading && schedules.length === 0 ? (
        <Card>
          <Text style={styles.instruction}>
            Belum ada jadwal obat aktif. Jadwal akan muncul setelah dokter menyetujui resep
            Anda di Puskesmas.
          </Text>
        </Card>
      ) : null}

      {schedules.length > 1 ? (
        <Card>
          <Text style={styles.cardLabel}>Jadwal Anda</Text>
          {schedules.map((item) => (
            <BigButton
              key={item.id}
              label={`${item.timeOfDay} — ${item.medicationName}`}
              variant={item.id === active?.id ? 'primary' : 'outline'}
              onPress={() => {
                setScheduleId(item.id)
                setStatus('IDLE')
                setErrorMessage(null)
                setConfirmedTime(null)
              }}
            />
          ))}
        </Card>
      ) : null}

      <View style={styles.actionGroup}>
        {status === 'SUCCESS' ? (
          <BigButton
            label="Sudah dikonfirmasi"
            variant="success"
            icon={<CheckCircle2Icon size={18} color={colors.textOnPrimary} />}
            disabled
            onPress={() => {}}
          />
        ) : (
          <BigButton
            label={status === 'LOADING' ? 'Mengonfirmasi…' : 'Sudah minum'}
            variant="primary"
            icon={<PillIcon size={18} color={colors.textOnPrimary} />}
            isLoading={status === 'LOADING'}
            onPress={handleConfirm}
          />
        )}

        <Text style={styles.note}>
          Panggilan darurat 112 hanya tersedia di layar darurat. Di layar ini tidak ada tombol
          telepon sama sekali.
        </Text>
      </View>
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
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  medText: {
    flexShrink: 1,
    gap: 2,
  },
  cardLabel: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  medicationName: {
    ...typography.h1,
    fontWeight: '700',
    color: colors.text,
  },
  instruction: {
    ...typography.body,
    color: colors.textSecondary,
  },
  successBanner: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  bannerText: {
    flex: 1,
    gap: spacing.xs,
  },
  successTitle: {
    ...typography.h2,
    color: colors.success,
  },
  successDesc: {
    ...typography.bodySmall,
    color: colors.success,
  },
  errorTitle: {
    ...typography.h2,
    color: colors.danger,
  },
  errorDesc: {
    ...typography.bodySmall,
    color: colors.danger,
  },
  retryHint: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.danger,
    fontStyle: 'italic',
  },
  actionGroup: {
    gap: spacing.md,
  },
  note: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
})