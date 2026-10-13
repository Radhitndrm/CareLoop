import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, hitSize, radius, spacing, toneSurface, typography, type Tone } from '../theme/tokens'

type Variant = 'primary' | 'success' | 'danger' | 'secondary' | 'outline'

export function BigButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  isLoading,
  size = 'md',
}: {
  label: string
  onPress: () => void
  variant?: Variant
  icon?: ReactNode
  disabled?: boolean
  isLoading?: boolean
  size?: 'md' | 'lg'
}) {
  const height = size === 'lg' ? hitSize.danger : hitSize.min
  const palette = resolvePalette(variant)
  const isInactive = disabled || isLoading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(isInactive), busy: Boolean(isLoading) }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height, backgroundColor: palette.bg, borderColor: palette.border },
        variant === 'primary' && styles.shadow,
        pressed && !isInactive ? styles.pressed : null,
        isInactive ? styles.disabled : null,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            style={[
              styles.label,
              { color: palette.fg },
              size === 'lg' ? styles.labelLarge : null,
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

function resolvePalette(variant: Variant) {
  switch (variant) {
    case 'primary':
      return toneSurface.primary
    case 'success':
      return { bg: colors.success, fg: colors.textOnPrimary, border: colors.success }
    case 'danger':
      return toneSurface.danger
    case 'secondary':
      return { bg: colors.primarySoft, fg: colors.textSecondary, border: colors.primarySoft }
    case 'outline':
      return { bg: 'transparent', fg: colors.primary, border: colors.border }
  }
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.button.fontSize,
    fontWeight: '700',
    textAlign: 'center',
  },
  labelLarge: {
    fontSize: 20,
    lineHeight: 26,
  },
  shadow: {
    shadowColor: colors.primary,
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.5,
  },
})