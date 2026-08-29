import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { createHash, createPublicKey, verify as cryptoVerify } from "crypto";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { generateOTP, hashOTP, verifyOTP, sendOTP } from "../utils/otp";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { getFirebaseAuth, verifyIdToken, getUserByPhone, getUserByEmail, createUserWithPhone, createUserWithEmail } from "../services/firebaseAuthService";

interface OtpRecord {
  otpHash: string;
  expiresAt: Date;
  verified: boolean;
}

const otpStore = new Map<string, OtpRecord>();

function setOtp(key: string): string {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);
  otpStore.set(key, { otpHash: hashOTP(otp), expiresAt, verified: false });
  return otp;
}

function getOtp(key: string): OtpRecord | undefined {
  const record = otpStore.get(key);
  if (!record) return undefined;
  if (record.expiresAt.getTime() < Date.now()) {
    otpStore.delete(key);
    return undefined;
  }
  return record;
}

async function createUserSession(userId: string, req: Request): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken({ userId, email: (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? "" });
  const refreshToken = generateRefreshToken(userId);

  // Multi-device support: keep existing sessions alive, only purge this
  // device's expired/stale rows. Logging in on a phone must not log out the
  // user's laptop.
  await prisma.session.deleteMany({
    where: {
      userId,
      OR: [
        { expiresAt: { lte: new Date() } },
        { ipAddress: req.ip ?? req.socket.remoteAddress ?? null, userAgent: req.headers["user-agent"] ?? null },
      ],
    },
  });
  await prisma.session.create({
    data: {
      userId,
      refreshToken,
      ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}

async function recordLogin(userId: string, req: Request): Promise<void> {
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  const userAgent = req.headers["user-agent"] ?? null;
  await prisma.loginHistory.create({
    data: { userId, ipAddress: ip, userAgent },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

function firebasePlaceholderEmail(uid: string): string {
  return `${uid}@users.noreply.rentbuddy.app`;
}

function firebasePlaceholderPhone(uid: string): string {
  const digest = createHash("sha256").update(`rentbuddy-firebase-phone:${uid}`).digest("hex");
  const digits = BigInt(`0x${digest.slice(0, 16)}`).toString().padStart(10, "0").slice(-10);
  return `+910${digits}`;
}

async function createOrGetUserFromFirebase(uid: string, email?: string, phone?: string, fullName?: string) {
  let user = await prisma.user.findUnique({ where: { firebaseUid: uid } });
  if (user) return user;

  const claims = [
    ...(email ? [{ email }] : []),
    ...(phone ? [{ phone }] : []),
  ];
  if (claims.length > 0) {
    const existing = await prisma.user.findFirst({ where: { OR: claims } });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { firebaseUid: uid },
      });
      return user;
    }
  }

  const passwordHash = await bcrypt.hash(generateOTP(32), env.BCRYPT_SALT_ROUNDS);
  user = await prisma.user.create({
    data: {
      email: email ?? firebasePlaceholderEmail(uid),
      phone: phone ?? firebasePlaceholderPhone(uid),
      passwordHash,
      fullName: fullName?.trim() || "Firebase User",
      dateOfBirth: new Date("2000-01-01"),
      gender: "OTHER",
      role: "USER",
      activeRole: "USER",
      firebaseUid: uid,
      emailVerified: !!email,
      mobileVerified: !!phone,
    },
  });

  await prisma.wallet.create({ data: { userId: user.id } });
  return user;
}

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, phone, password, fullName, dateOfBirth, gender, accountType, role } = req.body;

    // Input validation
    if (!email && !phone) {
      sendError(res, "Email or phone is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendError(res, "Invalid email format.", 400, "VALIDATION_ERROR");
      return;
    }
    if (phone && !/^\+?[\d\s\-()]{7,15}$/.test(phone)) {
      sendError(res, "Invalid phone format.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!password || password.length < 6) {
      sendError(res, "Password must be at least 6 characters.", 400, "VALIDATION_ERROR");
      return;
    }
    if (fullName && fullName.length > 100) {
      sendError(res, "Full name must be 100 characters or less.", 400, "VALIDATION_ERROR");
      return;
    }

    const rawAccountType = String(accountType || role || "USER").toUpperCase();
    const normalizedAccountType = ["USER", "PARTNER"].includes(rawAccountType) ? rawAccountType : "USER";

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      sendError(res, "Email or phone already registered.", 409, "DUPLICATE_USER");
      return;
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        fullName,
        dateOfBirth: new Date(dateOfBirth || "2000-01-01"),
        gender: gender || "OTHER",
        role: "USER",
        activeRole: "USER",
      },
      select: { id: true, email: true, phone: true, fullName: true, status: true, role: true, activeRole: true },
    });

    if (normalizedAccountType === "PARTNER") {
      await prisma.partner.upsert({
        where: { userId: user.id },
        update: { status: "PENDING" },
        create: {
          userId: user.id,
          status: "PENDING",
          providesWalking: true,
          providesCarry: true,
        },
      });
    }

    await prisma.wallet.create({ data: { userId: user.id } });

    const otp = setOtp(`email:${user.id}`);
    sendOTP(otp, { email: user.email });

    const { accessToken, refreshToken } = await createUserSession(user.id, req);

    const responseUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      activeRole: user.activeRole || user.role,
      accountType: normalizedAccountType,
    };

    sendSuccess(res, { accessToken, refreshToken, user: responseUser }, "Registration successful. OTP sent for email verification.", 201);
  } catch (err) {
    console.error("register error:", err);
    sendError(res, "Registration failed.", 500, "INTERNAL_ERROR");
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { identifier, password, email, phone } = req.body;
    const loginIdentifier = identifier || email || phone;
    if (!loginIdentifier || !password) {
      sendError(res, "Email/phone and password are required.", 400, "MISSING_FIELDS");
      return;
    }
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: loginIdentifier }, { phone: loginIdentifier }] },
    });
    if (!user) {
      sendError(res, "Invalid credentials.", 401, "INVALID_CREDENTIALS");
      return;
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      sendError(res, "Invalid credentials.", 401, "INVALID_CREDENTIALS");
      return;
    }
    if (user.status !== "ACTIVE") {
      sendError(res, "Account is not active.", 403, "ACCOUNT_INACTIVE");
      return;
    }

    // Admin-tier accounts must always resolve their session role from the
    // stored account type — never from a stale activeRole left over from a
    // previous regular-user session.
    const ADMIN_TIER_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE"];
    let effectiveActiveRole = user.activeRole || user.role;
    if (ADMIN_TIER_ROLES.includes(user.role) && effectiveActiveRole !== user.role) {
      await prisma.user.update({ where: { id: user.id }, data: { activeRole: user.role } });
      effectiveActiveRole = user.role;
    }

    const { accessToken, refreshToken } = await createUserSession(user.id, req);
    await recordLogin(user.id, req);

    const responseUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      activeRole: effectiveActiveRole,
      accountType: effectiveActiveRole || "USER",
    };

    sendSuccess(res, { accessToken, refreshToken, user: responseUser }, "Login successful.");
  } catch (err) {
    sendError(res, "Login failed.", 500, "INTERNAL_ERROR");
  }
}

// Phone OTP - Send OTP
export async function sendPhoneOTP(req: Request, res: Response): Promise<void> {
  try {
    const { phone } = req.body;
    
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      // Dev fallback: OTP logged server-side (no real SMS). In production this
      // must error loudly rather than report a delivery that never happens.
      if (env.isProduction) {
        sendError(res, "Phone OTP delivery is not configured (no SMS provider).", 503, "SMS_NOT_CONFIGURED");
        return;
      }
      const otp = setOtp(`phone:${phone}`);
      sendOTP(otp, { phone });
      // OTP and phone numbers must never be written to logs (PII / account-takeover risk).
      sendSuccess(res, { sent: true, dev: true }, "OTP sent via dev fallback (check server console).");
      return;
    }

    // Firebase path: confirm the phone number is valid via Firebase.
    try {
      const firebaseUser = await getUserByPhone(phone);
      if (!firebaseUser) {
        // Create user in Firebase
        await createUserWithPhone(phone);
      }
      // In production, Firebase handles OTP sending via client SDK.
      // Here we just confirm the phone number is valid.
      sendSuccess(res, { sent: true }, "OTP sent. Please check your phone.");
    } catch (fbErr) {
      if (env.isProduction) {
        console.error("sendPhoneOTP Firebase error:", fbErr);
        sendError(res, "Failed to send OTP.", 500, "INTERNAL_ERROR");
        return;
      }
      // Dev fallback: Firebase unavailable/misconfigured — deliver OTP locally so
      // the flow remains testable. In production this would be a real misconfig.
      const otp = setOtp(`phone:${phone}`);
      sendOTP(otp, { phone });
      sendSuccess(res, { sent: true, dev: true }, "OTP sent via dev fallback (check server console).");
    }
  } catch (err) {
    console.error("sendPhoneOTP error:", err);
    sendError(res, "Failed to send OTP.", 500, "INTERNAL_ERROR");
  }
}

// Phone OTP - Verify OTP
export async function verifyPhoneOTP(req: Request, res: Response): Promise<void> {
  try {
    const { phone, otp } = req.body;
    
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      // Fallback to local OTP verification
      const record = getOtp(`phone:${phone}`);
      if (!record || !verifyOTP(otp, record.otpHash)) {
        sendError(res, "Invalid or expired OTP.", 400, "INVALID_OTP");
        return;
      }
      otpStore.delete(`phone:${phone}`);
      
      // Atomic: find-or-create user with upsert to prevent race condition
      const placeholderEmail = `${phone.replace(/\D/g, '')}@phone.placeholder`;
      const passwordHash = await bcrypt.hash(generateOTP(32), env.BCRYPT_SALT_ROUNDS);
      let user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        try {
          user = await prisma.user.create({
            data: {
              phone,
              email: placeholderEmail,
              passwordHash,
              fullName: "Phone User",
              dateOfBirth: new Date("2000-01-01"),
              gender: "OTHER",
              mobileVerified: true,
            },
          });
          await prisma.wallet.create({ data: { userId: user.id } });
        } catch (createErr: any) {
          // Unique constraint violation = concurrent create won. Retry find.
          if (createErr.code === 'P2002') {
            user = await prisma.user.findUnique({ where: { phone } });
          } else {
            throw createErr;
          }
        }
      } else {
        await prisma.user.update({ where: { id: user.id }, data: { mobileVerified: true } });
      }

      if (!user) {
        sendError(res, "Failed to create or find user.", 500, "INTERNAL_ERROR");
        return;
      }

      const { accessToken, refreshToken } = await createUserSession(user.id, req);
      await recordLogin(user.id, req);

      sendSuccess(res, { accessToken, refreshToken, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } }, "Phone verified and logged in.");
      return;
    }

    // Firebase verification would be done client-side with Firebase SDK
    // Server verifies the ID token from Firebase
    sendError(res, "Use Firebase client SDK for phone auth verification.", 400, "USE_CLIENT_SDK");
  } catch (err) {
    console.error("verifyPhoneOTP error:", err);
    sendError(res, "Phone verification failed.", 500, "INTERNAL_ERROR");
  }
}

// Google Sign-In
export async function googleSignIn(req: Request, res: Response): Promise<void> {
  try {
    const { idToken } = req.body;

    // Try Firebase first, fall back to google-auth-library
    const firebaseAuth = getFirebaseAuth();
    let email: string | undefined;
    let name: string | undefined;
    let picture: string | undefined;
    let uid: string | undefined;
    let phone_number: string | undefined;

    if (firebaseAuth) {
      try {
        const decoded = await verifyIdToken(idToken);
        uid = decoded.uid;
        email = decoded.email;
        phone_number = decoded.phone_number;
        name = decoded.name;
        picture = decoded.picture;
      } catch {
        // Firebase verification failed, try google-auth-library
      }
    }

    if (!uid) {
      // Use google-auth-library to verify the ID token directly
      const { OAuth2Client } = require("google-auth-library");
      const clientId = env.GOOGLE_CLIENT_ID;
      const client = new OAuth2Client(clientId);
      try {
        const ticket = await client.verifyIdToken({
          idToken,
          audience: clientId,
        });
        const payload = ticket.getPayload();
        if (!payload) {
          sendError(res, "Invalid Google token.", 401, "INVALID_TOKEN");
          return;
        }
        uid = payload.sub;
        email = payload.email;
        name = payload.name;
        picture = payload.picture;
      } catch {
        sendError(res, "Google token verification failed.", 401, "INVALID_TOKEN");
        return;
      }
    }

    if (!uid) {
      sendError(res, "Could not verify Google identity.", 401, "INVALID_TOKEN");
      return;
    }

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone_number ? [{ phone: phone_number }] : []),
        ],
      },
    });

    if (user) {
      // Update avatar if new
      if (picture && user.avatarUrl !== picture) {
        await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: picture } });
      }
    } else {
      const passwordHash = await bcrypt.hash(generateOTP(32), env.BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          email: email || `google-${uid}@rentbuddy.app`,
          phone: phone_number || `+91${uid.slice(0, 10)}`,
          passwordHash,
          fullName: name || "Google User",
          dateOfBirth: new Date("2000-01-01"),
          gender: "OTHER",
          emailVerified: true,
          mobileVerified: !!phone_number,
          avatarUrl: picture,
        },
      });
      await prisma.wallet.create({ data: { userId: user.id } });
    }

    const { accessToken, refreshToken } = await createUserSession(user.id, req);
    await recordLogin(user.id, req);

    sendSuccess(res, { accessToken, refreshToken, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } }, "Google sign-in successful.");
  } catch (err) {
    console.error("googleSignIn error:", err);
    sendError(res, "Google sign-in failed.", 500, "INTERNAL_ERROR");
  }
}

// Verify an Apple identity token (ES256 JWT signed by Apple) using Apple's
// published JWKS. Returns the stable Apple subject id + email. Throws on any
// verification failure so the caller can reject the sign-in.
async function verifyAppleIdentityToken(idToken: string): Promise<{ sub: string; email?: string }> {
  if (!env.APPLE_CLIENT_ID) throw new Error("Apple sign-in is not configured");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed Apple token");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

  const res = await fetch("https://appleid.apple.com/auth/keys");
  if (!res.ok) throw new Error("Failed to fetch Apple signing keys");
  const { keys } = (await res.json()) as { keys: Record<string, unknown>[] };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("No matching Apple signing key");

  const key = createPublicKey({ key: jwk as any, format: "jwk" });
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, "base64url");
  if (!cryptoVerify("sha256", data, key, signature)) throw new Error("Invalid Apple token signature");

  if (payload.iss !== "https://appleid.apple.com") throw new Error("Invalid token issuer");
  if (payload.aud !== env.APPLE_CLIENT_ID) throw new Error("Invalid token audience");
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) throw new Error("Apple token expired");

  return { sub: payload.sub, email: payload.email };
}

// Apple Sign-In — real OIDC verification, env-gated.
export async function appleSignIn(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!env.APPLE_CLIENT_ID) {
      sendError(res, "Apple sign-in is not configured on this server.", 400, "APPLE_NOT_CONFIGURED");
      return;
    }
    const { idToken, fullName } = req.body;
    if (!idToken || typeof idToken !== "string") {
      sendError(res, "Apple identity token is required.", 400, "MISSING_TOKEN");
      return;
    }

    let claims: { sub: string; email?: string };
    try {
      claims = await verifyAppleIdentityToken(idToken);
    } catch (e: any) {
      sendError(res, e?.message || "Apple token verification failed.", 401, "INVALID_TOKEN");
      return;
    }

    const appleId = claims.sub;
    let user = await prisma.user.findFirst({ where: { appleId } });
    if (!user && claims.email) {
      user = await prisma.user.findFirst({ where: { email: claims.email } });
    }

    if (!user) {
      const passwordHash = await bcrypt.hash(generateOTP(32), env.BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          email: claims.email || `apple-${appleId}@rentbuddy.app`,
          phone: `apple_${appleId.replace(/[^a-zA-Z0-9]/g, "")}`,
          passwordHash,
          fullName: fullName || "Apple User",
          dateOfBirth: new Date("2000-01-01"),
          gender: "OTHER",
          emailVerified: !!claims.email,
          appleId,
        },
      });
      await prisma.wallet.create({ data: { userId: user.id } });
    } else if (!user.appleId) {
      await prisma.user.update({ where: { id: user.id }, data: { appleId } });
    }

    const { accessToken, refreshToken } = await createUserSession(user.id, req);
    await recordLogin(user.id, req);
    sendSuccess(
      res,
      { accessToken, refreshToken, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } },
      "Apple sign-in successful."
    );
  } catch (err) {
    console.error("appleSignIn error:", err);
    sendError(res, "Apple sign-in failed.", 500, "INTERNAL_ERROR");
  }
}

export async function logout(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
    if (bodyToken) {
      try {
        const payload = verifyRefreshToken(bodyToken);
        await prisma.session.deleteMany({ where: { refreshToken: bodyToken, userId: payload.userId } });
        sendSuccess(res, undefined, "Logged out successfully.");
        return;
      } catch {
        // Token invalid, fall through
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const payload = verifyRefreshToken(token);
          await prisma.session.deleteMany({ where: { refreshToken: token, userId: payload.userId } });
          sendSuccess(res, undefined, "Logged out successfully.");
          return;
        } catch {
          // Token invalid, fall through
        }
      }
    }
    if (req.user?.userId) {
      await prisma.session.deleteMany({ where: { userId: req.user.userId } });
    }
    sendSuccess(res, undefined, "Logged out successfully.");
  } catch (err) {
    sendError(res, "Logout failed.", 500, "INTERNAL_ERROR");
  }
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      sendError(res, "Refresh token required.", 400, "MISSING_TOKEN");
      return;
    }
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      sendError(res, "Invalid refresh token.", 401, "INVALID_TOKEN");
      return;
    }

    const session = await prisma.session.findUnique({ where: { refreshToken: token } });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      sendError(res, "Refresh token expired or revoked.", 401, "TOKEN_EXPIRED");
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, email: true, status: true } });
    if (!user || user.status !== "ACTIVE") {
      sendError(res, "User not available.", 401, "UNAUTHORIZED");
      return;
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const newRefreshToken = generateRefreshToken(user.id);
    await prisma.session.update({ where: { id: session.id }, data: { refreshToken: newRefreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });

    sendSuccess(res, { accessToken, refreshToken: newRefreshToken }, "Token refreshed.");
  } catch (err) {
    sendError(res, "Token refresh failed.", 500, "INTERNAL_ERROR");
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const otp = setOtp(`reset:${user.id}`);
      sendOTP(otp, { email });
      // Never return the OTP or userId in the HTTP response — logging only,
      // and the response is IDENTICAL for existing/unknown accounts to prevent
      // account enumeration.
      if (process.env.NODE_ENV !== "production") {
        console.log(`[DEV ONLY] Password reset OTP for ${email}: ${otp}`);
      }
    }
    sendSuccess(res, undefined, "If the account exists, a reset OTP has been sent.");
  } catch (err) {
    sendError(res, "Request failed.", 500, "INTERNAL_ERROR");
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, "Invalid request.", 400, "INVALID_REQUEST");
      return;
    }
    const record = getOtp(`reset:${user.id}`);
    if (!record || !verifyOTP(otp, record.otpHash)) {
      sendError(res, "Invalid or expired OTP.", 400, "INVALID_OTP");
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    otpStore.delete(`reset:${user.id}`);
    sendSuccess(res, undefined, "Password reset successful.");
  } catch (err) {
    sendError(res, "Password reset failed.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  try {
    const { userId, otp } = req.body;
    if (!otp) {
      sendError(res, "OTP is required.", 400, "MISSING_OTP");
      return;
    }
    const record = getOtp(`email:${userId}`);
    if (!record) {
      // Do NOT auto-send OTP here — that enables email bombing via unauthenticated
      // requests. User must call /auth/resend-otp to request a new code.
      sendError(res, "No active OTP found. Please request a new code.", 400, "OTP_EXPIRED");
      return;
    }
    if (!verifyOTP(otp, record.otpHash)) {
      sendError(res, "Invalid or expired OTP.", 400, "INVALID_OTP");
      return;
    }
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    otpStore.delete(`email:${userId}`);
    sendSuccess(res, undefined, "Email verified successfully.");
  } catch (err) {
    sendError(res, "Email verification failed.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyMobile(req: Request, res: Response): Promise<void> {
  try {
    const { userId, otp } = req.body;
    if (!otp) {
      sendError(res, "OTP is required.", 400, "MISSING_OTP");
      return;
    }
    const record = getOtp(`mobile:${userId}`);
    if (!record) {
      // Do NOT auto-send OTP here — that enables SMS bombing via unauthenticated
      // requests. User must call /auth/resend-otp to request a new code.
      sendError(res, "No active OTP found. Please request a new code.", 400, "OTP_EXPIRED");
      return;
    }
    if (!verifyOTP(otp, record.otpHash)) {
      sendError(res, "Invalid or expired OTP.", 400, "INVALID_OTP");
      return;
    }
    await prisma.user.update({ where: { id: userId }, data: { mobileVerified: true } });
    otpStore.delete(`mobile:${userId}`);
    sendSuccess(res, undefined, "Mobile verified successfully.");
  } catch (err) {
    sendError(res, "Mobile verification failed.", 500, "INTERNAL_ERROR");
  }
}

export async function resendOTP(req: Request, res: Response): Promise<void> {
  try {
    const { userId, channel } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    const key = channel === "mobile" ? `mobile:${userId}` : `email:${userId}`;
    const otp = setOtp(key);
    sendOTP(otp, channel === "mobile" ? { phone: user.phone } : { email: user.email });
    sendSuccess(res, undefined, `OTP resent to ${channel}.`);
  } catch (err) {
    sendError(res, "Failed to resend OTP.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, "Invalid credentials.", 401, "INVALID_CREDENTIALS");
      return;
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      sendError(res, "Invalid credentials.", 401, "INVALID_CREDENTIALS");
      return;
    }
    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken(user.id);
    sendSuccess(res, { accessToken, refreshToken, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } }, "Password verified.");
  } catch (err) {
    sendError(res, "Password verification failed.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SWITCH ACTIVE ACCOUNT ROLE (USER <-> PARTNER)
// ============================================================================

const SWITCHABLE_ROLES = ["USER", "PARTNER"];
const ADMIN_TIER_ROLES_SWITCH = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE"];

export async function switchRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { role } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    if (user.status !== "ACTIVE") {
      sendError(res, "Account is not active.", 403, "ACCOUNT_INACTIVE");
      return;
    }

    const isAdminTier = ADMIN_TIER_ROLES_SWITCH.includes(user.role);
    // Admin-tier accounts may switch between their own admin tier, USER and
    // PARTNER views (for oversight/testing of every account type). Regular
    // accounts remain limited to USER <-> PARTNER.
    const allowedRoles = isAdminTier ? [user.role, ...SWITCHABLE_ROLES] : SWITCHABLE_ROLES;
    if (!allowedRoles.includes(role)) {
      sendError(res, isAdminTier ? `Role must be one of: ${allowedRoles.join(", ")}.` : "Role must be USER or PARTNER.", 400, "INVALID_ROLE");
      return;
    }
    if (!isAdminTier && ADMIN_TIER_ROLES_SWITCH.includes(role)) {
      sendError(res, "Admin access cannot be self-granted.", 403, "FORBIDDEN");
      return;
    }

    if (role === "PARTNER") {
      let partner = await prisma.partner.findUnique({ where: { userId: user.id }, select: { status: true } });
      // Admin-tier accounts get a provisioned APPROVED partner profile so the
      // partner view is fully inspectable without a public application.
      if ((!partner || partner.status !== "APPROVED") && isAdminTier) {
        partner = await prisma.partner.upsert({
          where: { userId: user.id },
          update: { status: "APPROVED" },
          create: { userId: user.id, status: "APPROVED", providesWalking: true, providesCarry: true },
        });
      }
      if (!partner || partner.status !== "APPROVED") {
        sendError(res, "Partner access requires admin approval.", 403, "PARTNER_NOT_APPROVED");
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { activeRole: role },
      select: { id: true, email: true, fullName: true, role: true, activeRole: true },
    });

    sendSuccess(res, { user: updated }, `Switched to ${role} account.`);
  } catch (err) {
    console.error("switchRole error:", err);
    sendError(res, "Failed to switch account role.", 500, "INTERNAL_ERROR");
  }
}
