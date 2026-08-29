import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { env } from "../config/env";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(env.CLERK_JWKS_URL));
  }
  return jwks;
}

export async function verifyClerkToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: "https://willing-leech-39.clerk.accounts.dev",
    });
    return payload;
  } catch (err: any) {
    console.error("Clerk token verification failed:", err?.message || err);
    return null;
  }
}

export function isClerkEnabled(): boolean {
  return !!env.CLERK_SECRET_KEY && !env.CLERK_SECRET_KEY.includes("YOUR_");
}
