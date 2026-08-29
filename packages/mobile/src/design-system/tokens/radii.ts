/**
 * RentBuddy 2026 — Border Radius Tokens
 */
export const Radii = {
  none: 0,
  xs: 4,
  sm: 8,
  chip: 8,
  button: 12,
  card: 16,
  modal: 20,
  bottomSheet: 24,
  avatar: 999,
  full: 9999,
} as const;

export type RadiusKey = keyof typeof Radii;
