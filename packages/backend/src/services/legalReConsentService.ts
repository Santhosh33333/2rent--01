// ============================================================================
// Re-consent for accounts that predate consent enforcement.
//
// Accounts created before the signup gate shipped hold no LegalAcceptance
// rows. Their consent is deliberately NOT reconstructed: a signature nobody
// gave is not consent, and writing one would put a false record into an
// append-only evidence table while binding nobody to anything.
//
// Instead each person is told, and the grace clock starts the moment they are
// told. They keep full access during that window. Once it lapses, consent-gated
// actions are refused until they actually sign.
//
// The rule this encodes: a deadline nobody was shown is not a deadline.
// ============================================================================
import { prisma } from "../config/database";
import { env } from "../config/env";
import { getConsentStatus } from "./legalConsentService";
import { sendEmail } from "./emailService";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";

const DEFAULT_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function graceDaysFromEnv(): number {
  const raw = env.LEGAL_RECONSENT_GRACE_DAYS;
  return typeof raw === "number" && raw >= 0 ? raw : DEFAULT_GRACE_DAYS;
}

export interface ReConsentState {
  /** True when the person has signed every current document the SIGNUP gate needs. */
  satisfied: boolean;
  /** True when they still owe a signature. */
  required: boolean;
  /** Null until they have actually been told. */
  notifiedAt: string | null;
  graceDays: number;
  graceEndsAt: string | null;
  graceExpired: boolean;
  daysRemaining: number;
  missing: string[];
  /** Only true once the grace window has lapsed AND consent is still owed. */
  blocking: boolean;
}

/**
 * Read the person's re-consent position, creating the notice row on first
 * contact. Creating it lazily is the whole point: the clock starts when they are
 * told, not when we happened to deploy.
 */
export async function getReConsentState(userId: string): Promise<ReConsentState> {
  const status = await getConsentStatus(userId, "SIGNUP");
  if (status.satisfied) {
    // Signing is what closes this out. Mark it so dashboards and reminders stop
    // chasing someone who already agreed.
    await prisma.legalReConsent.updateMany({
      where: { userId, satisfiedAt: null },
      data: { satisfiedAt: new Date() },
    });
    return {
      satisfied: true,
      required: false,
      notifiedAt: null,
      graceDays: 0,
      graceEndsAt: null,
      graceExpired: false,
      daysRemaining: 0,
      missing: [],
      blocking: false,
    };
  }

  const notice = await prisma.legalReConsent.upsert({
    where: { userId },
    create: { userId, graceDays: graceDaysFromEnv() },
    update: {},
  });

  const graceEndsAt = notice.notifiedAt.getTime() + notice.graceDays * DAY_MS;
  const remainingMs = graceEndsAt - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const graceExpired = remainingMs <= 0;

  void sendReConsentEmail(userId, {
    daysRemaining,
    graceExpired,
    notifiedAt: notice.notifiedAt.toISOString(),
  }).catch((err) => console.error("[LEGAL] re-consent notice failed:", err));

  return {
    satisfied: false,
    required: true,
    notifiedAt: notice.notifiedAt.toISOString(),
    graceDays: notice.graceDays,
    graceEndsAt: new Date(graceEndsAt).toISOString(),
    graceExpired,
    daysRemaining,
    missing: status.missing,
    // Grace exists precisely so a person is not cut off by a deadline they
    // never saw. Only a lapsed window turns an owed signature into a block.
    blocking: graceExpired,
  };
}

/**
 * How many accounts are owed a signature, for admin reporting.
 *
 * The exposed cohort is precisely "holds no non-withdrawn acceptance at all" -
 * those are the accounts created before the gate existed. Counting the notice
 * table instead would under-report, because a notice row only exists once
 * someone has actually been contacted.
 */
export async function countOutstandingReConsent(): Promise<{ total: number; blocking: number }> {
  const total = await prisma.user.count({
    where: {
      status: { not: "SUSPENDED" },
      legalAcceptances: { none: { withdrawnAt: null } },
    },
  });

  const notices = await prisma.legalReConsent.findMany({
    where: { satisfiedAt: null },
    select: { notifiedAt: true, graceDays: true },
  });
  const now = Date.now();
  let blocking = 0;
  for (const n of notices) {
    if (n.notifiedAt.getTime() + n.graceDays * DAY_MS <= now) blocking += 1;
  }
  return { total, blocking };
}

async function sendReConsentEmail(
  userId: string,
  ctx: { daysRemaining: number; graceExpired: boolean; notifiedAt: string }
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return;

  // One reminder per day per person. Without this the notice would re-send on
  // every authenticated request, which is how you get marked as spam.
  const since = await prisma.legalReConsent.findUnique({
    where: { userId },
    select: { lastRemindedAt: true, reminders: true },
  });
  if (since?.lastRemindedAt && Date.now() - since.lastRemindedAt.getTime() < DAY_MS) return;

  await prisma.legalReConsent.update({
    where: { userId },
    data: { lastRemindedAt: new Date(), reminders: { increment: 1 } },
  });

  const heading = ctx.graceExpired
    ? "Please review the updated Nabri terms"
    : `Please review the Nabri terms within ${ctx.daysRemaining} day${ctx.daysRemaining === 1 ? "" : "s"}`;
  const bodyHtml = ctx.graceExpired
    ? `<p style="margin:0 0 14px">Hi ${escHtml(user.fullName || "there")},</p>
<p style="margin:0 0 14px">Our terms were updated on ${new Date(ctx.notifiedAt).toLocaleDateString("en-IN", { dateStyle: "long" })}. Features that need these terms stay switched off for your account until you review and accept them.</p>
<p style="margin:0 0 14px">Nothing about your account, data or history has changed, and you can still read the documents before you decide.</p>`
    : `<p style="margin:0 0 14px">Hi ${escHtml(user.fullName || "there")},</p>
<p style="margin:0 0 14px">We have updated our terms and community guidelines. You have <strong>${ctx.daysRemaining} day${ctx.daysRemaining === 1 ? "" : "s"}</strong> to review them. Until then everything in your account keeps working as it does now.</p>`;

  const result = await sendEmail(
    user.email,
    heading,
    renderEmail({
      title: heading,
      kicker: "Account notice",
      bodyHtml,
      ctaText: "Review and accept",
      ctaUrl: `${WEB_ORIGIN}/legal/consent`,
      note: "We are asking you to agree to terms you can read in full before you accept. You keep a dated copy of everything you sign.",
    }),
    "Please review and accept the updated Nabri terms in the app."
  );
  if (!result.ok) console.error("[LEGAL] re-consent email not delivered:", result.error);
}
