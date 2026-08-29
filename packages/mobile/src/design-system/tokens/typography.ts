/**
 * RentBuddy 2026 — Design System Typography Tokens
 * Headings: Plus Jakarta Sans
 * Body: Inter
 */
export const Typography = {
  fontHeading: 'PlusJakartaSans',
  fontHeadingBold: 'PlusJakartaSans-Bold',
  fontHeadingSemiBold: 'PlusJakartaSans-SemiBold',
  fontBody: 'Inter',
  fontBodyMedium: 'Inter-Medium',
  fontBodySemiBold: 'Inter-SemiBold',
  fontBodyBold: 'Inter-Bold',

  sizes: {
    display: 32,
    headline: 24,
    title: 20,
    titleSmall: 18,
    body: 16,
    bodySmall: 14,
    label: 13,
    caption: 12,
    overline: 10,
  },

  lineHeights: {
    display: 40,
    headline: 32,
    title: 28,
    titleSmall: 24,
    body: 24,
    bodySmall: 20,
    label: 18,
    caption: 16,
    overline: 16,
  },

  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semiBold: '600' as const,
    bold: '700' as const,
    extraBold: '800' as const,
  },
} as const;

export type TypographySizeKey = keyof typeof Typography.sizes;
