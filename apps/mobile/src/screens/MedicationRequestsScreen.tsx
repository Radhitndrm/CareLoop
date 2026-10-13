import React from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ClipboardListIcon, TriangleAlertIcon } from 'lucide-react'
import { Card } from '../components/Card'
import { StatusBadge } from '../components/feedback'
import { colors, radius, spacing, toneSurface, typography, type Tone } from '../theme/tokens'
import { getMyMedicationRequests, type MedicationRequestItem } from '../services/api'

const STATUS_LABEL: Record<string, string> = {
  PENDING_DOCTOR: 'Menunggu persetujuan dokter',
  QUEUED: 'Sedang disiapkan farmasi',
  PREPARING: 'Sedang disiapkan',
  READY: 'Siap diambil di Puskesmas',
  DISPENSED: 'Sudah diambil',
  REJECTED: 'Ditolak dokter',
  OUT_OF_STOCK: 'Stok obat kosong',
  SUBSTITUTED: 'Obat diganti',
}

const STATUS_TONE: Record<string, Tone> = {
  PENDING_DOCTOR: 'warning',
  QUEUED: 'neutral',
  PREPARING: 'primary',
  READY: 'success',
  DISPENSED: 'success',
  REJECTED: 'danger',
  OUT_OF_STOCK: 'warning',
  SUBSTITUTED: 'primary',
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export interface MedicationRequestsScreenProps {
  requests: MedicationRequestItem[]
  isLoading: boolean
  errorMessage: string | null
  onRefresh: () => void
}

/**
 * Status permintaan obat milik pasien (docs/API.md §3.6).
 *
 * Menampilkan alasan penolakan dari dokter bila ada — pasien berhak tahu
 * kenapa permintaannya tidak bisa dipenuhi, dan itu juga dikirim lewat WhatsApp.
 */
export function MedicationRequestsScreen({
  requests,
  isLoading,
  errorMessage,
  onRefresh,
}: MedicationRequestsScreenProps) {
  if (isLoading && requests.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  if (errorMessage) {
    return (
      <View style={styles.center}>
        <TriangleAlertIcon size={22} color={colors.danger} />
        <Text style={styles.errorText}>{errorMessage}</Text>
      </View>
    )
  }

  if (requests.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <StatusBadge
            label="Belum ada permintaan"
            tone="neutral"
            icon={<ClipboardListIcon size={14} color={colors.neutral} />}
          />
          <Text style={styles.emptyTitle}>Belum ada permintaan obat</Text>
          <Text style={styles.emptyBody}>
            Gunakan tab “Minta Obat” bila perlu mengambil lebih awal atau obat Anda hilang.
          </Text>
        </Card>
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} />}
    >
      {requests.map((request) => {
        const tone = STATUS_TONE[request.status] ?? 'neutral'
        const rejected = request.status === 'REJECTED'
        return (
          <Card key={request.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.medName}>
                {request.medicationName} {request.dosage ?? ''}
              </Text>
              <StatusBadge
                label={STATUS_LABEL[request.status] ?? request.status}
                tone={tone}
              />
            </View>

            <Text style={styles.meta}>
              Diminta {request.requestedQuantity} hari · {request.reasonLabel ?? 'Tanpa alasan'}
              {' · '}jatuh tempo {formatDate(request.dueAt)}
            </Text>
            {request.reasonNotes ? (
              <Text style={styles.notes}>Catatan Anda: {request.reasonNotes}</Text>
            ) : null}

            {rejected && (request.blockedReason ?? request.doctorDecisionNote) ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonTitle}>Alasan dari dokter</Text>
                <Text style={styles.reasonBody}>
                  {request.blockedReason ?? request.doctorDecisionNote}
                </Text>
              </View>
            ) : null}
          </Card>
        )
      })}
    </ScrollView>
  )
}

export async function loadMyRequests(): Promise<MedicationRequestItem[]> {
  return getMyMedicationRequests()
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  medName: {
    flex: 1,
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
  },
  notes: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  reasonBox: {
    backgroundColor: toneSurface.danger.bg,
    borderColor: toneSurface.danger.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  reasonTitle: {
    ...typography.label,
    color: colors.danger,
  },
  reasonBody: {
    ...typography.bodySmall,
    color: colors.danger,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
  },
})