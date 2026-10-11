import { type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getOrCreateFirebaseApp } from "./firebaseCredential.js";

let firebaseApp: App | null = null;

export function initializeFirebase(): void {
  try {
    // Shares the default app with firebaseAuthService. Initialising it a second
    // time here used to throw and get swallowed, leaving firebaseApp null and
    // silently disabling every push notification.
    firebaseApp = getOrCreateFirebaseApp();
    if (!firebaseApp) {
      console.warn("FIREBASE_SERVICE_ACCOUNT not set. Push notifications will be disabled.");
    }
  } catch (err) {
    console.error("Failed to initialize Firebase Admin:", err instanceof Error ? err.message : err);
  }
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (!firebaseApp) {
    return;
  }

  try {
    const { prisma } = await import("../config/database.js");
    // Every device the user has registered, not just the first. `findFirst`
    // meant a user with a phone and a tablet only ever got the push on one of
    // them, which reads as "notifications are unreliable".
    const devices = await prisma.device.findMany({
      where: { userId, fcmToken: { not: null } },
      select: { id: true, fcmToken: true },
    });

    if (devices.length === 0) {
      return;
    }

    const messaging = getMessaging(firebaseApp);
    const staleIds: string[] = [];

    await Promise.all(
      devices.map(async (device) => {
        if (!device.fcmToken) return;
        try {
          await messaging.send({
            token: device.fcmToken,
            notification: { title, body },
            data,
            android: {
              // High priority so the message is delivered even while the app is
              // dozing in the background, and routed to the channel the client
              // creates; without a live channel Android 8+ drops it silently.
              priority: "high",
              notification: {
                channelId: "nabri_default",
                sound: "default",
              },
            },
          });
        } catch (err) {
          const code = (err as { code?: string })?.code || "";
          // FCM reports a permanently-dead token with these codes; leaving them
          // in place meant every later send retried a token that can never work.
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument"
          ) {
            staleIds.push(device.id);
          } else {
            console.error(`Failed to send push notification to ${userId}:`, err);
          }
        }
      }),
    );

    if (staleIds.length > 0) {
      await prisma.device
        .updateMany({ where: { id: { in: staleIds } }, data: { fcmToken: null } })
        .catch(() => {});
    }
  } catch (err) {
    console.error(`Failed to send push notification to ${userId}:`, err);
  }
}
