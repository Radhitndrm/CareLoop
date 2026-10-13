import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, spacing, toneSurface, typography, type Tone } from '../theme/tokens'

/** Putaran 360° untuk indikator proses — menghormati Reduce Motion lewat
 * `AccessibilityInfo` tidak di inflict; durasi tetap pendek & tak mengganggu. */
export function Spinner({ size = 18, color }: { size?: number; color: string }) {
  const spin = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [spin])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color,
        borderTopColor: 'transparent',
        transform: [{ rotate }],
      }}
    />
  )
}

export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string
  tone?: Tone
  icon?: ReactNode
}) {
  const palette = toneSurface[tone]
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {icon}
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}

/** Meter progres dengan penanda ujung, warna berubah hijau → amber → merah. */
export function ProgressBar({
  value,
  tone,
  height = 10,
}: {
  value: number
  tone?: Tone
  height?: number
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const resolved: Tone = tone ?? (clamped >= 80 ? 'success' : clamped >= 50 ? 'warning' : 'danger')
  const palette = toneSurface[resolved]

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      <View
        style={{
          width: `${clamped}%`,
          backgroundColor: palette.fg,
          borderRadius: height / 2,
        }}
      />
    </View>
  )
}

export function Chip({
  label,
  isActive,
  onPress,
}: {
  label: string
  isActive: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      style={({ pressed }) => [
        styles.chip,
        isActive
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed ? styles.chipPressed : null,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: isActive ? colors.textOnPrimary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** Wadah ikon berwarna — menggantikan gambar sementara dengan ikon. */
export function IconWell({
  children,
  tone = 'primary',
  size = 44,
}: {
  children: ReactNode
  tone?: Tone
  size?: number
}) {
  const palette = toneSurface[tone]
  return (
    <View
      style={[
        styles.iconWell,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  label: {
    ...typography.bodySmall,
    fontSize: 13,
    fontWeight: '600',
  },
  track: {
    width: '100%',
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chipLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  chipPressed: {
    opacity: 0.85,
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
})