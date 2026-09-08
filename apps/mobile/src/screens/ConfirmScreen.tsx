import React, { useState, useEffect } from 'react'
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { BigButton } from '../components/BigButton'
import {
  confirmCompliance,
  ComplianceConfirmResponseData,
} from '../services/api'

export interface ConfirmScreenProps {
  initialScheduleId?: string
  medicationName?: string
  instruction?: string
  scheduleTime?: string
  isFromDeepLink?: boolean
  onSuccess?: (result: ComplianceConfirmResponseData) => void
}

// Default dummy UUID yang valid untuk keperluan demo
const DEFAULT_SCHEDULE_ID = '11111111-1111-4111-8111-111111111111'
const EMERGENCY_PHONE = 'tel:112'

export function ConfirmScreen({
  initialScheduleId,
  medicationName = 'Metformin 500 mg',
  instruction = '1 tablet setelah sarapan pagi',
  scheduleTime = '08:00 WIB',
  isFromDeepLink = false,
  onSuccess,
}: ConfirmScreenProps) {
  const [scheduleId, setScheduleId] = useState<string>(
    initialScheduleId || DEFAULT_SCHEDULE_ID
  )
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [confirmedTime, setConfirmedTime] = useState<string | null>(null)

  useEffect(() => {
    if (initialScheduleId && initialScheduleId !== scheduleId) {
      setScheduleId(initialScheduleId)
      // Reset status jika schedule ID berubah via deep link
      setStatus('IDLE')
      setErrorMessage(null)
      setConfirmedTime(null)
    }
  }, [initialScheduleId])

  const handleConfirm = async () => {
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

  const handleCallEmergency = () => {
    Linking.openURL(EMERGENCY_PHONE)
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CareLoop</Text>
        <Text style={styles.subtitle}>Kepatuhan Obat &amp; Bantuan Darurat</Text>
      </View>

      {/* Banner info deep link */}
      {isFromDeepLink && (
        <View style={styles.deepLinkBanner}>
          <Text style={styles.deepLinkText}>
            🔗 Terbuka dari tautan pengingat WhatsApp
          </Text>
        </View>
      )}

      {/* Card informasi obat */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Waktunya Minum Obat</Text>
        <Text style={styles.medicationName}>{medicationName}</Text>
        <Text style={styles.instruction}>{instruction}</Text>
        <View style={styles.timeBadge}>
          <Text style={styles.timeText}>⏰ {scheduleTime}</Text>
        </View>
        <Text style={styles.scheduleIdText}>ID Jadwal: {scheduleId}</Text>
      </View>

      {/* Banner status hasil konfirmasi */}
      {status === 'SUCCESS' && (
        <View style={styles.successBanner}>
          <Text style={styles.successTitle}>✅ Obat Berhasil Dikonfirmasi!</Text>
          <Text style={styles.successDesc}>
            Terima kasih telah minum obat tepat waktu ({confirmedTime}). Eskalasi darurat otomatis dibatalkan.
          </Text>
        </View>
      )}

      {status === 'ERROR' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>❌ Konfirmasi Gagal</Text>
          <Text style={styles.errorDesc}>{errorMessage}</Text>
          <Text style={styles.retryHint}>Silakan tekan tombol di bawah untuk mencoba kembali.</Text>
        </View>
      )}

      {/* Tombol aksi utama */}
      <View style={styles.actionGroup}>
        {status === 'SUCCESS' ? (
          <BigButton
            label="✓ Sudah Dikonfirmasi"
            color="#059669"
            disabled={true}
            onPress={() => {}}
          />
        ) : (
          <BigButton
            label={status === 'LOADING' ? 'Mengonfirmasi...' : '💊 Sudah Minum'}
            color="#16A34A"
            loading={status === 'LOADING'}
            onPress={handleConfirm}
          />
        )}

        <BigButton
          label="📞 Panggil 112"
          color="#DC2626"
          onPress={handleCallEmergency}
        />
        <Text style={styles.note}>
          Tombol 112 adalah panggilan manual one-tap, bukan auto-dial.
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#FAFAF9',
    padding: 24,
    justifyContent: 'center',
    gap: 18,
  },
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1C1917',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 18,
    color: '#57534E',
    marginTop: 4,
  },
  deepLinkBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  deepLinkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1D4ED8',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#78716C',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  medicationName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1C1917',
  },
  instruction: {
    fontSize: 18,
    color: '#44403C',
    lineHeight: 24,
  },
  timeBadge: {
    backgroundColor: '#F5F5F4',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
  },
  timeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#292524',
  },
  scheduleIdText: {
    fontSize: 12,
    color: '#A8A29E',
    marginTop: 4,
  },
  successBanner: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
    borderWidth: 2,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#14532D',
  },
  successDesc: {
    fontSize: 16,
    color: '#166534',
    lineHeight: 22,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
    borderWidth: 2,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#7F1D1D',
  },
  errorDesc: {
    fontSize: 16,
    color: '#991B1B',
    lineHeight: 22,
  },
  retryHint: {
    fontSize: 14,
    color: '#B91C1C',
    fontStyle: 'italic',
  },
  actionGroup: {
    marginTop: 8,
    gap: 14,
  },
  note: {
    fontSize: 14,
    color: '#78716C',
    textAlign: 'center',
    marginTop: 4,
  },
})
