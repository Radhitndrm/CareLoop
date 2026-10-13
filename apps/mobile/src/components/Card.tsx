import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, radius, spacing, typography } from '../theme/tokens'

export function Card({
  children,
  style,
}: {
  children: ReactNode
  style?: object
}) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.cardTitle}>{children}</Text>
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <Text style={styles.cardDescription}>{children}</Text>
}

/** Baris label–nilai, dipakai di kartu profil & detail. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.text,
  },
  cardDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  infoLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  infoValue: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
})