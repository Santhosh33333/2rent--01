import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getAuth, Auth, UserRecord, DecodedIdToken } from "firebase-admin/auth";

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;

export function initializeFirebaseAuth(): void {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      console.warn("FIREBASE_SERVICE_ACCOUNT not set. Firebase Auth will be disabled.");
      return;
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    if (getApps().length === 0) {
      firebaseApp = initializeApp({
        credential: cert(serviceAccount),
      });
    } else {
      firebaseApp = getApps()[0];
    }
    
    firebaseAuth = getAuth(firebaseApp);
  } catch (err) {
    console.warn("Failed to initialize Firebase Auth:", err);
  }
}

export function getFirebaseAuth(): Auth | null {
  return firebaseAuth;
}

export async function createCustomToken(uid: string, claims?: Record<string, any>): Promise<string> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.createCustomToken(uid, claims);
}

export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.verifyIdToken(idToken);
}

export async function createUserWithPhone(phoneNumber: string): Promise<UserRecord> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.createUser({ phoneNumber });
}

export async function createUserWithEmail(email: string, password: string, displayName?: string): Promise<UserRecord> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.createUser({ email, password, displayName });
}

export async function getUserByPhone(phoneNumber: string): Promise<UserRecord | null> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  try {
    return await firebaseAuth.getUserByPhoneNumber(phoneNumber);
  } catch (err: any) {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  }
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch (err: any) {
    if (err.code === "auth/user-not-found") return null;
    throw err;
  }
}

export async function updateUser(uid: string, properties: { displayName?: string; photoURL?: string; emailVerified?: boolean; phoneNumber?: string; disabled?: boolean }): Promise<UserRecord> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.updateUser(uid, properties);
}

export async function deleteUser(uid: string): Promise<void> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.deleteUser(uid);
}

export async function setCustomClaims(uid: string, claims: Record<string, any>): Promise<void> {
  if (!firebaseAuth) throw new Error("Firebase Auth not initialized");
  return firebaseAuth.setCustomUserClaims(uid, claims);
}