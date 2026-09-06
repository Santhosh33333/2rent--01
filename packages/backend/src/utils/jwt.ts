import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthPayload } from "../types";

interface AccessTokenPayload {
  userId: string;
  email: string;
  type: "access";
  impersonatorId?: string;
}

interface RefreshTokenPayload {
  userId: string;
  type: "refresh";
  jti: string;
  impersonatorId?: string;
}

interface TwoFactorChallengePayload {
  userId: string;
  email: string;
  type: "twofactor";
}

const accessSecret = env.JWT_ACCESS_SECRET ?? (env.JWT_SECRET as string);
const refreshSecret = env.JWT_REFRESH_SECRET ?? (env.JWT_SECRET as string);

export function generateAccessToken(user: AuthPayload): string {
  const payload: AccessTokenPayload = {
    userId: user.userId,
    email: user.email,
    type: "access",
  };
  return jwt.sign(payload, accessSecret, {
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions["expiresIn"],
  });
}

export function generateImpersonationAccessToken(user: AuthPayload, impersonatorId: string): string {
  const payload: AccessTokenPayload = {
    userId: user.userId,
    email: user.email,
    type: "access",
    impersonatorId,
  };
  return jwt.sign(payload, accessSecret, {
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions["expiresIn"],
  });
}

export function generateRefreshToken(userId: string, impersonatorId?: string): string {
  const payload: RefreshTokenPayload = {
    userId,
    type: "refresh",
    jti: crypto.randomUUID(),
    ...(impersonatorId ? { impersonatorId } : {}),
  };
  return jwt.sign(payload, refreshSecret, {
    expiresIn: env.JWT_REFRESH_EXPIRY as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, accessSecret) as jwt.JwtPayload;
  if (decoded.type !== "access") {
    throw new Error("Invalid token type");
  }
  return decoded as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, refreshSecret) as jwt.JwtPayload;
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return decoded as RefreshTokenPayload;
}

// Short-lived token issued after password check when 2FA is enabled. It authorizes
// exactly one subsequent call to the 2FA verification endpoint.
export function generateTwoFactorChallengeToken(userId: string, email: string): string {
  const payload: TwoFactorChallengePayload = { userId, email, type: "twofactor" };
  return jwt.sign(payload, accessSecret, { expiresIn: "5m" });
}

export function verifyTwoFactorChallengeToken(token: string): TwoFactorChallengePayload {
  const decoded = jwt.verify(token, accessSecret) as jwt.JwtPayload;
  if (decoded.type !== "twofactor") {
    throw new Error("Invalid token type");
  }
  return decoded as TwoFactorChallengePayload;
}
