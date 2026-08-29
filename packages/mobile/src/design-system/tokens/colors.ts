/**
 * RentBuddy 2026 — Design System Color Tokens
 * Based on Material Design 3 + Glassmorphism style
 */
export const Colors = {
  // Brand
  primary: '#6750A4',
  primaryContainer: '#EADDFF',
  secondary: '#625B71',
  tertiary: '#7D5260',

  // Surfaces (Light)
  background: '#FFFBFE',
  surface: 'rgba(255,255,255,0.15)',
  surfaceVariant: '#E7E0EC',

  // Surfaces (Dark)
  backgroundDark: '#0F0F0F',
  surfaceDark: '#1C1C1E',
  surfaceDarkGlass: 'rgba(28,28,30,0.75)',

  // Semantic
  error: '#B3261E',
  errorContainer: '#F9DEDC',
  success: '#386A20',
  successContainer: '#C3E7AC',
  warning: '#7D5700',
  warningContainer: '#FFDEA7',
  info: '#00639B',
  infoContainer: '#C9E6FF',

  // Text (Light)
  onPrimary: '#FFFFFF',
  onBackground: '#1C1B1F',
  onSurface: '#1C1B1F',
  onSurfaceVariant: '#49454F',

  // Text (Dark)
  onSurfaceDark: '#E6E1E5',
  onBackgroundDark: '#E6E1E5',

  // Outline
  outline: '#79747E',
  outlineVariant: '#CAC4D0',

  // Fixed neutrals
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export type ColorKey = keyof typeof Colors;
