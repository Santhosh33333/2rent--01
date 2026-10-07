import { Capacitor } from '@capacitor/core';
import { Device as CapDevice } from '@capacitor/device';
import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { api } from './api';

let attempted = false;
let registeredThisSession = false;

const PUSH_OPTIN_KEY = 'nabri-push-optin'

// Must match `com.google.firebase.messaging.default_notification_channel_id`
// in android/app/src/main/AndroidManifest.xml.
export const DEFAULT_CHANNEL_ID = 'nabri_default'

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isPushOptedIn(): boolean {
  // Default ON. There is no settings toggle wired to setPushOptedIn, and the
  // old "must be exactly '1'" test meant no device ever registered for push, so
  // no notification ever reached the status bar. Treat the flag as an explicit
  // opt-OUT: only a stored '0' disables notifications.
  try {
    return localStorage.getItem(PUSH_OPTIN_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setPushOptedIn(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PUSH_OPTIN_KEY);
    else localStorage.setItem(PUSH_OPTIN_KEY, '0');
  } catch {
    // storage unavailable — persist on next launch
  }
}

/**
 * FCM on Android 8+ will not display a notification unless it targets a
 * channel that exists. Create our channel before registering so the very first
 * notification already has somewhere to land. No-op off Android.
 */
async function ensureNotificationChannel(): Promise<void> {
  try {
    if (Capacitor.getPlatform() !== 'android') return;
    await PushNotifications.createChannel({
      id: DEFAULT_CHANNEL_ID,
      name: 'Nabri notifications',
      description: 'Calls, messages, bookings and payment updates',
      importance: 5, // IMPORTANCE_HIGH — heads-up banner in the status bar
      visibility: 1, // VISIBILITY_PUBLIC
      vibration: true,
    });
  } catch {
    // Channel creation is best-effort; FCM falls back to its own channel.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativeApp() || !isPushOptedIn()) return false;
  try {
    const result = await PushNotifications.requestPermissions();
    return result.receive === 'granted';
  } catch {
    return false;
  }
}

function obtainToken(timeoutMs = 8000): Promise<string> {
  return new Promise<string>((resolve) => {
    let done = false;
    let handle: Promise<PluginListenerHandle> | undefined;
    const finish = (token: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (handle) void handle.then((h) => h.remove());
      resolve(token);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);
    handle = PushNotifications.addListener('registration', (res) => finish(res?.value || ''));
    void PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] token registration error:', err?.error || err);
      finish('');
    });
  });
}

export async function registerForPushNotifications(): Promise<boolean> {
  if (registeredThisSession || attempted || !isNativeApp()) return false;
  attempted = true;
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;

    await ensureNotificationChannel();
    await PushNotifications.register();
    const token = await obtainToken();
    if (!token) return false;

    let name: string | undefined;
    try {
      const info = await CapDevice.getInfo();
      name = [info?.name, info?.model].filter(Boolean).join(' ') || undefined;
    } catch {
      // ignore device info errors
    }

    await api.post('/notifications/device', {
      deviceType: 'android',
      fcmToken: token,
      name: name || 'Android',
    });
    registeredThisSession = true;
    return true;
  } catch (err) {
    console.warn('[push] registration failed:', err);
    return false;
  }
}