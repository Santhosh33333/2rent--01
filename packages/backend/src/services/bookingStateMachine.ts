/**
 * Booking state machine — the single source of truth for allowed status
 * transitions. Every booking mutation MUST pass through assertTransition.
 *
 * Controlled job workflow (critical rule #84):
 * PARTNER_ACCEPTED means "upcoming job" — it must NEVER jump straight to
 * IN_PROGRESS or COMPLETED. Start requires a verified START OTP, completion
 * requires a verified COMPLETION OTP after an explicit completion request.
 */

const TRANSITIONS: Record<string, string[]> = {
  PAYMENT_PENDING: ["PAYMENT_INITIATED", "PARTNER_SEARCHING", "CANCELLED", "EXPIRED"],
  PAYMENT_INITIATED: ["PAYMENT_SUCCESSFUL", "PAYMENT_PENDING", "CANCELLED", "EXPIRED"],
  PAYMENT_SUCCESSFUL: ["PARTNER_SEARCHING", "CANCELLED", "REFUND_INITIATED"],
  PARTNER_SEARCHING: ["PARTNER_ACCEPTED", "EXPIRED", "CANCELLED"],
  PARTNER_ACCEPTED: ["OTP_GENERATED", "CANCELLED", "REFUND_INITIATED", "EXPIRED"],
  OTP_GENERATED: ["IN_PROGRESS", "CANCELLED", "EXPIRED"],
  IN_PROGRESS: ["COMPLETION_REQUESTED", "CANCELLED"],
  COMPLETION_REQUESTED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: ["REFUND_INITIATED"],
  REFUND_INITIATED: ["REFUND_COMPLETED"],
  REFUND_COMPLETED: [],
  EXPIRED: [],
};

export const TERMINAL_STATUSES = Object.keys(TRANSITIONS).filter(
  (s) => TRANSITIONS[s].length === 0
);

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Throws a coded error when the transition is illegal.
 */
export function assertTransition(from: string, to: string): void {
  if (from === to) {
    throw Object.assign(new Error("Booking is already in this state."), {
      code: "INVALID_TRANSITION",
    });
  }
  if (!canTransition(from, to)) {
    throw Object.assign(
      new Error(`Cannot move booking from ${from} to ${to}.`),
      { code: "INVALID_TRANSITION" }
    );
  }
}
