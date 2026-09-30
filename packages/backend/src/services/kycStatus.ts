/**
 * KYC approval state, in one place.
 *
 * `requireKycVerified` gates Events, Chat, Bookings, Communities and the wallet
 * on Verification.status being one of these two values. Every session payload
 * has to carry the same signal: the web client builds its auth user straight
 * from the login response and routes a user whose KYC is approved but whose
 * payload omits the field straight back to /verification, which reads to them
 * as "chat is broken" / "events do not load".
 */
export const KYC_APPROVED_STATUSES = ["VERIFIED", "APPROVED"] as const;

export function isKycApproved(status: string | null | undefined): boolean {
  return typeof status === "string" && (KYC_APPROVED_STATUSES as readonly string[]).includes(status);
}

/**
 * The two KYC fields clients gate features on, shaped exactly like
 * `GET /users/profile` so both sources agree.
 */
export function kycSessionFields(verification?: { status?: string | null } | null): {
  kycStatus: string;
  kycRejectionReason: string | null;
  isVerified: boolean;
} {
  const kycStatus = verification?.status ?? "NOT_STARTED";
  return { kycStatus, kycRejectionReason: null, isVerified: isKycApproved(kycStatus) };
}