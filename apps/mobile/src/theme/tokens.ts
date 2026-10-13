/**
 * Token desain CareLoop untuk aplikasi pasien.
 *
 * Cerminan langsung dari `apps/web/src/app/globals.css` (bagian `:root`) supaya
 * web dan mobile tidak melenceng. Warnabrand satu keluarga hijau; amber dan
 * merah hanya untuk keselamatan (perhatian & darurat).
 */

export const colors = {
  background: '#f4f6ee',
  surface: '#ffffff',
  surfaceMuted: '#ebf0e7',
  surfaceSubtle: '#e1ecd9',

  text: '#15352a',
  textSecondary: '#244c3d',
  textMuted: '#5f7268',
  textOnPrimary: '#ffffff',

  primary: '#176b4d',
  primarySoft: '#e4ebdf',
  primarySoftest: 'rgb(23 107 77 / 10%)',

  success: '#12603c',
  successSurface: '#e4f4e9',
  successBorder: '#a8d5b9',

  warning: '#7a5209',
  warningSurface: '#fdf3e0',
  warningBorder: '#ecd09a',

  danger: '#b83e34',
  dangerSurface: '#fcecea',
  dangerBorder: '#eeb4ad',

  neutral: '#4a5a52',
  neutralSurface: '#f1f3f1',
  neutralBorder: '#d8ded9',

  border: '#d4dfd1',
  borderSoft: '#e8eee6',
  ring: '#176b4d',
} as const

export const radius = {
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 25, fontWeight: '400' },
  bodySmall: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
} as const

/** Target sentuh minimum 48px; tombol darurat 64px (docs/UI_UX.md §6.3). */
export const hitSize = {
  min: 48,
  danger: 64,
} as const

export const shadow = {
  plate: {
    shadowColor: '#15352a',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  lift: {
    shadowColor: '#176b4d',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

export const toneSurface: Record<Tone, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.textOnPrimary, border: colors.primary },
  success: {
    bg: colors.successSurface,
    fg: colors.success,
    border: colors.successBorder,
  },
  warning: {
    bg: colors.warningSurface,
    fg: colors.warning,
    border: colors.warningBorder,
  },
  danger: { bg: colors.dangerSurface, fg: colors.danger, border: colors.dangerBorder },
  neutral: {
    bg: colors.neutralSurface,
    fg: colors.neutral,
    border: colors.neutralBorder,
  },
}