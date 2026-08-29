import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'booking-store' });

const mmkvStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

export interface ActiveBooking {
  id: string;
  status: string;
  serviceType: 'WALKING_BUDDY' | 'CARRY_BUDDY';
  partnerId: string | null;
  pickupAddress: string;
  destAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  destLat: number | null;
  destLng: number | null;
  scheduledAt: string;
  finalAmount: number | null;
  otpStart: string | null;
  otpEnd: string | null;
}

interface BookingState {
  activeBooking: ActiveBooking | null;
  setActiveBooking: (booking: ActiveBooking | null) => void;
  updateActiveBookingStatus: (status: string) => void;
  clearActiveBooking: () => void;
}

export const useBookingStore = create<BookingState>()(
  persist(
    (set) => ({
      activeBooking: null,

      setActiveBooking: (booking) =>
        set({ activeBooking: booking }),

      updateActiveBookingStatus: (status) =>
        set((state) => ({
          activeBooking: state.activeBooking
            ? { ...state.activeBooking, status }
            : null,
        })),

      clearActiveBooking: () =>
        set({ activeBooking: null }),
    }),
    {
      name: 'rentbuddy-booking',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
