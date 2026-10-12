import { Capacitor } from '@capacitor/core';
import { Device as CapDevice } from '@capacitor/device';
import { App as CapApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { api } from './api';

let inFlight = false;
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

let foregroundPushAttached = false;
let actionListenerAttached = false;
let localActionListenerAttached = false;
let resumeRetryAttached = false;
let localNotificationSeq = 0;

/**
 * Retry registration whenever the app returns to the foreground until it
 * succeeds. Registration runs once after login; if that one attempt failed
 * (permission granted later in Settings, token timeout on a cold start, no
 * network), push stayed dead for the rest of the session. A resume is the
 * natural moment to try again.
 */
function attachResumeRetry(): void {
  if (resumeRetryAttached || !isNativeApp()) return;
  resumeRetryAttached = true;
  void CapApp.addListener('appStateChange', (state) => {
    if (state?.isActive && !registeredThisSession) {
      void registerForPushNotifications();
    }
  });
}

/**
 * Android renders a `notification` payload in the status bar only while the app
 * is backgrounded. In the foreground `pushNotificationReceived` fires and the
 * platform shows nothing at all, so a user with the app open saw the socket
 * event update the in-app bell and never a status-bar notification - which is
 * exactly the "notification comes inside the app but not in the mobile
 * notification bar" report. Re-posting the message as a local notification
 * makes a foreground push look identical to a background one.
 */
function attachForegroundPushListener(): void {
  if (foregroundPushAttached || !isNativeApp()) return;
  foregroundPushAttached = true;
  void PushNotifications.addListener('pushNotificationReceived', (msg) => {
    const title = msg?.title || 'Nabri';
    const body = msg?.body || '';
    if (!body) return;
    void (async () => {
      try {
        await ensureNotificationChannel();
        await LocalNotifications.schedule({
          notifications: [
            {
              id: ++localNotificationSeq,
              title,
              body,
              channelId: DEFAULT_CHANNEL_ID,
              // Carry the original FCM data through, so tapping this re-posted
              // banner can still route (see the local-action listener below).
              extra: (msg.data ?? {}) as Record<string, string>,
            },
          ],
        });
      } catch (err) {
        console.warn('[push] foreground status-bar notification failed:', err);
      }
    })();
  });
}

/**
 * Android fires `pushNotificationActionPerformed` when the user taps a status-bar
 * notification. There was no listener, so a tap only opened the app and did
 * nothing useful - an incoming call had almost always already timed out. Dispatch
 * a DOM event so app-level code can route the tap (e.g. to the caller's chat so
 * the user can ring back).
 */
export function attachNotificationActionListener(): void {
  if (actionListenerAttached || !isNativeApp()) return;
  actionListenerAttached = true;
  void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action?.notification?.data || {}) as Record<string, unknown>;
    try {
      window.dispatchEvent(new CustomEvent('nabri:notification-action', { detail: data }));
    } catch {
      // Non-fatal: the tap simply opens the app with no extra routing.
    }
  });
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

/**
 * Clear the successful-registration latch. Called on logout so the next account
 * that signs in on this device re-registers its FCM token: the backend only
 * detaches the token from the previous user when the device re-registers, so a
 * stale latch meant the new user got no push and the old account's
 * notifications were delivered to this device instead.
 */
export function resetPushRegistration(): void {
  registeredThisSession = false;
}

/**
 * The foreground re-post (above) uses a *local* notification, so tapping it
 * fires `localNotificationActionPerformed` rather than the push action. There
 * was no listener for that, so a message that arrived while the app was open
 * produced a banner whose tap did nothing. Forward the `extra` we copied from
 * the FCM payload through the same DOM event the push-tap path uses.
 */
export function attachLocalNotificationActionListener(): void {
  if (localActionListenerAttached || !isNativeApp()) return;
  localActionListenerAttached = true;
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = action?.notification?.extra;
    if (!extra || typeof extra !== 'object') return;
    window.dispatchEvent(new CustomEvent('nabri:notification-action', { detail: extra }));
  });
}

export async function registerForPushNotifications(): Promise<boolean> {
  attachForegroundPushListener();
  attachNotificationActionListener();
  attachLocalNotificationActionListener();
  attachResumeRetry();
  // Only a *successful* registration is latched (`registeredThisSession`). The
  // old `attempted` latch meant a single transient failure — a denied-then-
  // granted permission, an 8s token timeout, a dropped network — disabled push
  // for the rest of the session with no way to recover until a full restart.
  if (registeredThisSession || inFlight || !isNativeApp()) return false;
  inFlight = true;
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;

    await ensureNotificationChannel();
    await PushNotifications.register();
    // One retry: the first token callback occasionally arrives after the 8s
    // window on a cold start.
    let token = await obtainToken();
    if (!token) token = await obtainToken(12000);
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
  } finally {
    inFlight = false;
  }
}