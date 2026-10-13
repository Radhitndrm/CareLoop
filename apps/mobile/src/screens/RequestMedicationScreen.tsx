import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, Pressable, View } from 'react-native'
import { CheckCircle2Icon, PillIcon, SendIcon, TriangleAlertIcon } from 'lucide-react'
import { BigButton } from '../components/BigButton'
import { Card } from '../components/Card'
import { StatusBadge } from '../components/feedback'
import { colors, radius, spacing, typography } from '../theme/tokens'
import {
  requestMedication,
  type MedicationOption,
  type MedicationRequestItem,
} from '../services/api'

const REASONS = [
  { code: 'EARLY_PICKUP', label: 'Ambil lebih awal' },
  { code: 'MEDICATION_LOST', label: 'Obat hilang' },
  { code: 'DAMAGED', label: 'Obat rusak' },
  { code: 'EXTRA', label: 'Tambahan obat' },
  { code: 'OTHER', label: 'Lainnya' },
] as const

export interface RequestMedicationScreenProps {
  medications: MedicationOption[]
  onSubmitted?: (request: MedicationRequestItem) => void
}

/**
 * Form "Minta obat" untuk pasien (docs/API.md §3.6).
 *
 * Pasien hanya bisa meminta obat yang sudah ada resep aktifnya — daftarnya
 * berasal dari GET /v1/patients/me/medications, bukan katalog obat bebas.
 * Setelah dikirim, permintaan berstatus PENDING_DOCTOR dan menunggu
 * keputusan dokter di dashboard web.
 */
export function RequestMedicationScreen({
  medications,
  onSubmitted,
}: RequestMedicationScreenProps) {
  const [medicationId, setMedicationId] = useState<string>(medications[0]?.id ?? '')
  const [quantity, setQuantity] = useState('30')
  const [reasonCode, setReasonCode] = useState<string>('EARLY_PICKUP')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selected = medications.find((m) => m.id === medicationId) ?? null
  const needsNotes = reasonCode === 'OTHER'
  const quantityNum = Number(quantity)
  const canSubmit =
    Boolean(medicationId) &&
    quantityNum >= 1 &&
    quantityNum <= 365 &&
    (!needsNotes || notes.trim().length > 0) &&
    status !== 'LOADING'

  const submit = async () => {
    if (!canSubmit) return
    setStatus('LOADING')
    setErrorMessage(null)
    try {
      const created = await requestMedication({
        medicationId,
        requestedQuantity: quantityNum,
        reasonCode,
        ...(notes.trim() ? { reasonNotes: notes.trim() } : {}),
      })
      setStatus('SUCCESS')
      setNotes('')
      onSubmitted?.(created)
    } catch (err: unknown) {
      setStatus('ERROR')
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengirim permintaan obat')
    }
  }

  if (medications.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <StatusBadge
            label="Belum ada obat aktif"
            tone="neutral"
            icon={<PillIcon size={14} color={colors.neutral} />}
          />
          <Text style={styles.emptyTitle}>Belum ada obat aktif</Text>
          <Text style={styles.emptyBody}>
            Permintaan obat hanya bisa dibuat untuk obat yang sudah diresepkan dokter dan sedang
            Anda minum.
          </Text>
        </Card>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <StatusBadge
          label="Minta obat"
          tone="primary"
          icon={<PillIcon size={14} color={colors.primary} />}
        />
        <Text style={styles.sectionTitle}>Kirim permintaan obat</Text>
        <Text style={styles.hint}>
          Permintaan Anda ditinjau dokter lebih dulu sebelum masuk antrean farmasi.
        </Text>

        <Text style={styles.label}>Pilih obat</Text>
        <View style={styles.options}>
          {medications.map((medication) => {
            const active = medication.id === medicationId
            return (
              <Pressable
                key={medication.id}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => setMedicationId(medication.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {medication.name} {medication.dosage ?? ''}
                </Text>
                {medication.quantityRemaining !== null ? (
                  <Text style={styles.optionMeta}>
                    sisa {medication.quantityRemaining} hari
                  </Text>
                ) : null}
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>Jumlah (hari)</Text>
        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          placeholder="30"
          accessibilityLabel="Jumlah hari yang diminta"
        />

        <Text style={styles.label}>Alasan</Text>
        <View style={styles.options}>
          {REASONS.map((reason) => {
            const active = reason.code === reasonCode
            return (
              <Pressable
                key={reason.code}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => setReasonCode(reason.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {reason.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>Catatan {needsNotes ? '(wajib)' : '(opsional)'}</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="mis. Botol obat terkena air"
          accessibilityLabel="Catatan untuk dokter"
        />

        {status === 'SUCCESS' ? (
          <View style={styles.successBox}>
            <CheckCircle2Icon size={18} color={colors.success} />
            <Text style={styles.successText}>
              Permintaan terkirim. Statusnya sekarang “Menunggu persetujuan dokter”.
            </Text>
          </View>
        ) : null}

        {status === 'ERROR' && errorMessage ? (
          <View style={styles.errorBox}>
            <TriangleAlertIcon size={18} color={colors.danger} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <BigButton
          label={status === 'LOADING' ? 'Mengirim…' : 'Kirim permintaan'}
          variant="primary"
          icon={<SendIcon size={18} color={colors.textOnPrimary} />}
          onPress={submit}
          disabled={!canSubmit}
          isLoading={status === 'LOADING'}
        />

        {selected?.daysSupply !== null && selected?.daysSupply !== undefined ? (
          <Text style={styles.hint}>
            Jatah per pengambilan untuk obat ini: {selected.daysSupply} hari.
          </Text>
        ) : null}
      </Card>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.h1,
    color: colors.text,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  optionActive: {
    backgroundColor: colors.successSurface,
    borderColor: colors.primary,
  },
  optionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  optionLabelActive: {
    color: colors.success,
  },
  optionMeta: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  textarea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  successText: {
    ...typography.bodySmall,
    color: colors.success,
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.danger,
    flex: 1,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
})