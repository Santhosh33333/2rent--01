import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';
import { Appearance } from 'react-native';

const storage = new MMKV({ id: 'theme-store' });

const mmkvStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setPreference: (pref: ThemePreference) => void;
  resolveTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: 'system',
      resolvedTheme: (Appearance.getColorScheme() ?? 'light') as 'light' | 'dark',

      setPreference: (pref) => {
        const resolved =
          pref === 'system'
            ? ((Appearance.getColorScheme() ?? 'light') as 'light' | 'dark')
            : pref;
        set({ preference: pref, resolvedTheme: resolved });
      },

      resolveTheme: () => {
        const { preference } = get();
        if (preference === 'system') {
          const systemTheme = (Appearance.getColorScheme() ?? 'light') as 'light' | 'dark';
          set({ resolvedTheme: systemTheme });
        }
      },
    }),
    {
      name: 'rentbuddy-theme',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
