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
    const device = await prisma.device.findFirst({
      where: { userId, fcmToken: { not: null } },
      select: { fcmToken: true },
    });

    if (!device || !device.fcmToken) {
      return;
    }

    const messaging = getMessaging(firebaseApp);
    await messaging.send({
      token: device.fcmToken,
      notification: { title, body },
      data,
      android: {
        // High priority so the message is delivered even while the app is
        // dozing in the background, and routed to the channel the client
        // creates — without a live channel Android 8+ drops it silently.
        priority: "high",
        notification: {
          channelId: "nabri_default",
          sound: "default",
        },
      },
    });
  } catch (err) {
    console.error(`Failed to send push notification to ${userId}:`, err);
  }
}
