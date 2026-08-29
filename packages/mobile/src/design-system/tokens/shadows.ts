import { Platform } from 'react-native';

/**
 * RentBuddy 2026 — Shadow Tokens
 */
export const Shadows = {
  soft: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
    },
    android: {
      elevation: 4,
    },
    default: {},
  }),

  medium: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
    },
    android: {
      elevation: 8,
    },
    default: {},
  }),

  strong: Platform.select({
    ios: {
      shadowColor: '#6750A4',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 32,
    },
    android: {
      elevation: 12,
    },
    default: {},
  }),
} as const;
