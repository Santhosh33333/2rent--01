import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'offline-store' });

const mmkvStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

export interface OfflineAction {
  id: string;
  type: string; // 'SEND_MESSAGE' | 'BOOK_SERVICE' | 'UPDATE_PROFILE' | etc.
  payload: unknown;
  queuedAt: number; // unix timestamp
  retries: number;
}

interface OfflineState {
  isOnline: boolean;
  queue: OfflineAction[];
  setOnline: (online: boolean) => void;
  enqueue: (action: Omit<OfflineAction, 'id' | 'queuedAt' | 'retries'>) => void;
  dequeue: (id: string) => void;
  incrementRetry: (id: string) => void;
  clearQueue: () => void;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set) => ({
      isOnline: true,
      queue: [],

      setOnline: (online) =>
        set({ isOnline: online }),

      enqueue: (action) =>
        set((state) => ({
          queue: [
            ...state.queue,
            {
              ...action,
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              queuedAt: Date.now(),
              retries: 0,
            },
          ],
        })),

      dequeue: (id) =>
        set((state) => ({
          queue: state.queue.filter((a) => a.id !== id),
        })),

      incrementRetry: (id) =>
        set((state) => ({
          queue: state.queue.map((a) =>
            a.id === id ? { ...a, retries: a.retries + 1 } : a
          ),
        })),

      clearQueue: () =>
        set({ queue: [] }),
    }),
    {
      name: 'rentbuddy-offline',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
