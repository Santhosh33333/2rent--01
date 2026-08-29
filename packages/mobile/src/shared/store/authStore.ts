import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

// MMKV-backed storage for Zustand (faster than AsyncStorage)
const storage = new MMKV({ id: 'auth-store' });

const mmkvStorage = {
  getItem: (key: string) => {
    const value = storage.getString(key);
    return value ?? null;
  },
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

export interface AuthUser {
  id: string;
  firebaseUid: string;
  email: string;
  phone: string;
  fullName: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  activeRole: string | null;
  kycStatus: string;
  trustScore: number;
  status: string;
  city: string | null;
  language: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

interface AuthState {
  user: AuthUser | null;
  firebaseToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: AuthUser) => void;
  setFirebaseToken: (token: string) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      firebaseToken: null,
      isAuthenticated: false,
      isLoading: true,

      setUser: (user) =>
        set({ user, isAuthenticated: true, isLoading: false }),

      setFirebaseToken: (token) =>
        set({ firebaseToken: token }),

      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),

      logout: () =>
        set({
          user: null,
          firebaseToken: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setLoading: (loading) =>
        set({ isLoading: loading }),
    }),
    {
      name: 'rentbuddy-auth',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
