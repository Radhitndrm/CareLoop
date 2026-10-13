import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ClipboardListIcon, PillIcon, SirenIcon } from 'lucide-react'
import { colors, radius, spacing, typography } from '../theme/tokens'

export type TabKey = 'CONFIRM' | 'EMERGENCY' | 'REQUEST_MED' | 'MY_REQUESTS'

const TABS: Array<{
  key: TabKey
  label: string
  Icon: typeof PillIcon
  tone: 'primary' | 'danger'
}> = [
  { key: 'CONFIRM', label: 'Jadwal Obat', Icon: PillIcon, tone: 'primary' },
  { key: 'EMERGENCY', label: 'Darurat', Icon: SirenIcon, tone: 'danger' },
  { key: 'REQUEST_MED', label: 'Minta Obat', Icon: ClipboardListIcon, tone: 'primary' },
  { key: 'MY_REQUESTS', label: 'Permintaan Saya', Icon: ClipboardListIcon, tone: 'primary' },
]

/**
 * Baris tab memindahkan empat layar. Ikon selalu berpasangan dengan label teks
 * (docs/UI_UX.md §6.5), dan target sentuh mengikuti `hitSize.min`.
 */
export function TopTabs({
  activeTab,
  onChange,
}: {
  activeTab: TabKey
  onChange: (tab: TabKey) => void
}) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab
          const accent = tab.tone === 'danger' ? colors.danger : colors.primary
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab.label}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [
                styles.tab,
                isActive
                  ? { backgroundColor: accent, borderColor: accent }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
                pressed ? styles.pressed : null,
              ]}
            >
              <tab.Icon
                size={18}
                color={isActive ? colors.textOnPrimary : colors.textSecondary}
                strokeWidth={2}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color: isActive ? colors.textOnPrimary : colors.textSecondary },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scroll: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
})