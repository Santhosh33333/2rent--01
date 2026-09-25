import { Capacitor } from '@capacitor/core';
import { Device as CapDevice } from '@capacitor/device';
import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { api } from './api';

let attempted = false;
let registeredThisSession = false;

const PUSH_OPTIN_KEY = 'nabri-push-optin'

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isPushOptedIn(): boolean {
  try {
    return localStorage.getItem(PUSH_OPTIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPushOptedIn(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(PUSH_OPTIN_KEY, '1');
    else localStorage.removeItem(PUSH_OPTIN_KEY);
  } catch {
    // storage unavailable — persist on next launch
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