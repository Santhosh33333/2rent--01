import { initializeApp as initFirebaseApp, cert, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

let firebaseApp: App | null = null;

export function initializeFirebase(): void {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      console.warn("FIREBASE_SERVICE_ACCOUNT not set. Push notifications will be disabled.");
      return;
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseApp = initFirebaseApp({
      credential: cert(serviceAccount),
    });
  } catch (err) {
    console.warn("Failed to initialize Firebase Admin:", err);
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
    });
  } catch (err) {
    console.error(`Failed to send push notification to ${userId}:`, err);
  }
}
