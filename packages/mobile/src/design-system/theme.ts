import { Colors } from './tokens/colors';
import { Typography } from './tokens/typography';
import { Spacing } from './tokens/spacing';
import { Radii } from './tokens/radii';
import { Shadows } from './tokens/shadows';

const baseTheme = {
  typography: Typography,
  spacing: Spacing,
  radii: Radii,
  shadows: Shadows,
};

export const lightTheme = {
  ...baseTheme,
  dark: false,
  colors: {
    primary: Colors.primary,
    primaryContainer: Colors.primaryContainer,
    secondary: Colors.secondary,
    background: Colors.background,
    surface: Colors.surface,
    surfaceVariant: Colors.surfaceVariant,
    error: Colors.error,
    success: Colors.success,
    warning: Colors.warning,
    info: Colors.info,
    onPrimary: Colors.onPrimary,
    onBackground: Colors.onBackground,
    onSurface: Colors.onSurface,
    onSurfaceVariant: Colors.onSurfaceVariant,
    outline: Colors.outline,
    outlineVariant: Colors.outlineVariant,
    card: Colors.white,
    text: Colors.onBackground,
    border: Colors.outlineVariant,
    notification: Colors.error,
  },
} as const;

export const darkTheme = {
  ...baseTheme,
  dark: true,
  colors: {
    primary: Colors.primary,
    primaryContainer: Colors.primaryContainer,
    secondary: Colors.secondary,
    background: Colors.backgroundDark,
    surface: Colors.surfaceDarkGlass,
    surfaceVariant: Colors.surfaceDark,
    error: Colors.error,
    success: Colors.success,
    warning: Colors.warning,
    info: Colors.info,
    onPrimary: Colors.onPrimary,
    onBackground: Colors.onBackgroundDark,
    onSurface: Colors.onSurfaceDark,
    onSurfaceVariant: Colors.onSurfaceDark,
    outline: Colors.outline,
    outlineVariant: Colors.outlineVariant,
    card: Colors.surfaceDark,
    text: Colors.onSurfaceDark,
    border: Colors.outlineVariant,
    notification: Colors.error,
  },
} as const;

export type AppTheme = typeof lightTheme;
export type ThemeColors = AppTheme['colors'];
