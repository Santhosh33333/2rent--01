import { cert, getApps, initializeApp, type App } from "firebase-admin/app";

/**
 * Private-key IDs that must never be used again. A key ID is only an
 * identifier, not a secret, so keeping it here as a tombstone is safe, and it
 * stops an already-exposed credential from being pasted into Render and
 * quietly taking over production.
 */
const REVOKED_PRIVATE_KEY_IDS = new Set([
  "e290c0108e874735bea19fd1be0228b22c8f4124", // nabri-9b94d, leaked 2026-09-27, still live in Firebase
  "3ea75160ad0c1ebff43d4ed5b5cf1804873d48cb", // nabri-9faed, pasted 2026-09-27, project not adopted
  "ab8d12c0bbc15937ef340b9bc9967188982a08d2", // nabri-9b94d, superseded earlier, found in local dev .env
]);

export function loadFirebaseServiceAccount(): Record<string, any> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not valid JSON. It must be the whole service-account file minified to a single line.",
    );
  }

  const keyId = String(parsed.private_key_id ?? "");
  if (keyId && REVOKED_PRIVATE_KEY_IDS.has(keyId)) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT uses REVOKED key ${keyId}. This credential was exposed and must not be used. ` +
        `Generate a new private key in Firebase Console -> Project settings -> Service accounts, then replace this variable.`,
    );
  }

  const missing = ["project_id", "client_email", "private_key"].filter((f) => !parsed[f]);
  if (missing.length) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is missing required field(s): ${missing.join(", ")}`);
  }
  return parsed;
}

/**
 * Returns the shared Firebase app, creating it only if nothing has registered
 * one yet. Firebase throws if the default app is initialised twice, so both
 * firebaseAuthService and notificationService must go through here instead of
 * calling initializeApp themselves -- otherwise whichever ran second failed
 * silently and its feature was disabled with no error.
 *
 * Returns null when Firebase is simply not configured, so push/auth degrade
 * gracefully. Throws on a revoked or malformed credential, because that is a
 * misconfiguration the operator has to see.
 */
export function getOrCreateFirebaseApp(): App | null {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const serviceAccount = loadFirebaseServiceAccount();
  if (!serviceAccount) return null;

  return initializeApp({ credential: cert(serviceAccount) });
}
