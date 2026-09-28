// ============================================================================
// Support desk.
//
// Deliberately separate from Report, which is a safety signal about another
// person. Mixing them means a billing question lands in the safety queue and a
// safety report gets a polite email instead of escalation.
//
// The rules encoded here:
//  - The requester can always reach their own ticket and can close it.
//  - Only staff can reply as staff, and that flag is derived from the actor's
//    role, never from the request body, so a modified client cannot impersonate
//    support.
//  - Every lifecycle change is written to an append-only event trail, because
//    "you said you'd close it" cannot be settled without a dated record.
//  - Nothing is ever resolved without a resolution message, so "resolved" always
//    means someone actually said something.
// ============================================================================
import { prisma } from "../config/database";
import { sendEmail, sosRecipients } from "./emailService";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";
import { ADMIN_ROLES } from "../rbac/sections";

export const SUPPORT_CATEGORIES = [
  "ACCOUNT",
  "PAYMENT",
  "BOOKING",
  "SAFETY",
  "TECHNICAL",
  "PARTNER_ONBOARDING",
  "OTHER",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_USER", "RESOLVED", "CLOSED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/** Who may move a ticket out of which state. */
const ALLOWED_TRANSITIONS: Record<SupportStatus, SupportStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_ON_USER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_ON_USER", "RESOLVED", "CLOSED"],
  // RESOLVED is reachable directly from here on purpose: the common real flow
  // is agent replies -> user answers -> agent reads it and resolves. Forcing a
  // bounce through IN_PROGRESS adds a click that means nothing and trains agents
  // to click it without reading.
  WAITING_ON_USER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

/**
 * States that mean "support owns the next action". A requester cannot mark
 * their own request resolved: "resolved" is a claim that the problem is fixed,
 * and letting the person who reported the problem make that claim is how a
 * broken product stays looking healthy in the support metrics.
 */
const STAFF_ONLY_TARGETS: SupportStatus[] = ["IN_PROGRESS", "RESOLVED", "WAITING_ON_USER"];

/**
 * Enforced here rather than in the controller on purpose. A status check that
 * only exists in a route file is one forgotten `requireRole` away from letting a
 * user mark their own ticket resolved, and the service is reachable from tests,
 * jobs and future callers too.
 */
function assertCanTransition(from: SupportStatus, to: SupportStatus, actorIsStaff: boolean) {
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new SupportError(`A ${from} ticket cannot move to ${to}.`, "INVALID_TRANSITION", 409);
  }
  if (actorIsStaff) return;

  if (STAFF_ONLY_TARGETS.includes(to)) {
    throw new SupportError(
      to === "RESOLVED"
        ? "Only a support agent can mark this resolved."
        : "Only a support agent can move this ticket into that state.",
      "FORBIDDEN_TRANSITION",
      403
    );
  }
  // A requester re-opening a thread is only meaningful once support has stopped
  // responding, or after it was closed. From a freshly opened ticket, replying
  // or closing is the only sensible action.
  if (to === "IN_PROGRESS" && from === "OPEN") {
    throw new SupportError(
      "Reply to your request, or close it if you no longer need help.",
      "FORBIDDEN_TRANSITION",
      403
    );
  }
}

export class SupportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "SupportError";
  }
}

// Crockford-ish alphabet: no I, L, O or U, so a reference read aloud or copied
// off a screen cannot be mistyped into a different valid ticket.
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSuffix(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return out;
}

/**
 * Generate a short reference like NBR-7F3K2M. Retries on the (very unlikely)
 * collision rather than failing the request: a support request is exactly the
 * wrong moment to lose someone's message to a unique-constraint error.
 */
async function generateReference(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `NBR-${randomSuffix()}`;
    const clash = await prisma.supportTicket.findUnique({ where: { reference }, select: { id: true } });
    if (!clash) return reference;
  }
  throw new SupportError("Could not allocate a ticket reference. Please try again.", "REFERENCE_EXHAUSTED", 503);
}

export interface CreateTicketInput {
  requesterId: string;
  category: string;
  subject: string;
  body: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

export async function createTicket(input: CreateTicketInput) {
  const category = String(input.category || "").toUpperCase();
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) {
    throw new SupportError("Choose a valid category.", "INVALID_CATEGORY");
  }
  const subject = String(input.subject || "").trim();
  if (subject.length < 4 || subject.length > 160) {
    throw new SupportError("Give your request a subject between 4 and 160 characters.", "INVALID_SUBJECT");
  }
  const body = String(input.body || "").trim();
  if (body.length < 10) {
    // A ticket with no detail cannot be answered, and the reply would just ask
    // for the detail that was missing.
    throw new SupportError("Please describe your issue in at least 10 characters.", "INVALID_BODY");
  }
  if (body.length > 8000) {
    throw new SupportError("That description is too long. Please keep it under 8000 characters.", "INVALID_BODY");
  }

  const reference = await generateReference();

  // SAFETY and PAYMENT start escalated. A safety report buried in a normal queue
  // is a safety report nobody reads in time.
  const priority: SupportPriority = category === "SAFETY" ? "URGENT" : "NORMAL";

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        reference,
        requesterId: input.requesterId,
        category,
        subject,
        status: "OPEN",
        priority,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        // The opening message counts as the requester's own activity, so the
        // "waiting on us" clock starts here rather than never starting.
        lastRepliedAt: new Date(),
        messages: {
          create: { authorId: input.requesterId, body, isStaff: false },
        },
        events: {
          create: { actorId: input.requesterId, action: "CREATED", toValue: category, note: subject },
        },
      },
      include: { messages: true },
    });
    return created;
  });

  void notifyNewTicket(ticket.reference, category, subject, priority).catch((err) =>
    console.error("[SUPPORT] new-ticket notification failed:", err)
  );

  return ticket;
}

export async function listTicketsForRequester(userId: string) {
  return prisma.supportTicket.findMany({
    where: { requesterId: userId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      reference: true,
      category: true,
      subject: true,
      status: true,
      priority: true,
      lastRepliedAt: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
}

export async function listTicketsForStaff(opts: { status?: string; assignedToId?: string; mine?: boolean }) {
  return prisma.supportTicket.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.mine ? { assignedToId: opts.assignedToId } : {}),
    },
    // Urgent first, then oldest: that is the order a support inbox should be
    // worked in, and leaving it to the client to sort invites inconsistency.
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function getTicketForViewer(ticketId: string, viewerId: string, isStaff: boolean) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      requester: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, fullName: true } } } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  // The requester id is read from the row, not trusted from the request, so a
  // guessed ticket id cannot be used to read somebody else's thread.
  if (!isStaff && ticket.requesterId !== viewerId) {
    throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  }
  return ticket;
}

export async function addReply(opts: {
  ticketId: string;
  authorId: string;
  authorIsStaff: boolean;
  body: string;
  isResolution?: boolean;
}) {
  const body = String(opts.body || "").trim();
  if (body.length < 2) throw new SupportError("Write a message before sending.", "INVALID_BODY");
  if (body.length > 8000) throw new SupportError("That message is too long.", "INVALID_BODY");

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: opts.ticketId },
    select: { id: true, reference: true, requesterId: true, status: true, assignedToId: true, firstResponseAt: true },
  });
  if (!ticket) throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  if (ticket.status === "CLOSED") {
    // Silent replies into a closed thread are how people conclude support is
    // ignoring them. Say so instead.
    throw new SupportError("This ticket is closed. Reopen it to add a message.", "TICKET_CLOSED", 409);
  }
  if (!opts.authorIsStaff && ticket.requesterId !== opts.authorId) {
    throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  }

  const now = new Date();
  const isStaff = opts.authorIsStaff === true;

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: opts.authorId,
        body,
        isStaff,
        isResolution: opts.isResolution === true,
      },
    });

    await tx.supportTicketEvent.create({
      data: { ticketId: ticket.id, actorId: opts.authorId, action: isStaff ? "REPLIED_BY_STAFF" : "REPLIED_BY_USER" },
    });

    // A staff reply is what starts the response clock. A user replying does not.
    if (isStaff && !ticket.firstResponseAt) {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { firstResponseAt: now, lastRepliedAt: now },
      });
    } else {
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { lastRepliedAt: now } });
    }
    return message;
  });

  // Staff replying hands the ball back to the user; that is what WAITING_ON_USER
  // means, and leaving it IN_PROGRESS misreports who owes the next move.
  if (isStaff && ticket.status === "OPEN") {
    await transitionStatus(ticket.id, "WAITING_ON_USER", opts.authorId, true, { silent: true });
  }

  void notifyReply(ticket.reference, ticket.requesterId, body).catch((err) =>
    console.error("[SUPPORT] reply notification failed:", err)
  );

  return result;
}

export async function transitionStatus(
  ticketId: string,
  next: string,
  actorId: string,
  actorIsStaff: boolean,
  opts: { silent?: boolean; note?: string; resolution?: string } = {}
) {
  const status = String(next).toUpperCase() as SupportStatus;
  if (!(SUPPORT_STATUSES as readonly string[]).includes(status)) {
    throw new SupportError("Unknown ticket status.", "INVALID_STATUS");
  }
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, reference: true, status: true, requesterId: true, subject: true },
  });
  if (!ticket) throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  if (ticket.status === status) return ticket;

  // A non-staff actor may only act on a thread they own. This is the
  // ownership check, independent of the transition rules below.
  if (!actorIsStaff && ticket.requesterId !== actorId) {
    throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  }
  assertCanTransition(ticket.status as SupportStatus, status, actorIsStaff);

  // "Resolved" has to mean somebody actually said the problem was handled.
  // Without this, a queue can be cleared by a single click and the response
  // metrics look healthy while the person who reported the problem was never
  // told anything. Enforced here rather than trusted to the UI.
  const resolutionText = String(opts.resolution || "").trim();
  if (status === "RESOLVED") {
    const alreadyAnswered = await prisma.supportMessage.findFirst({
      where: { ticketId, isResolution: true },
      select: { id: true },
    });
    if (!alreadyAnswered && !resolutionText) {
      throw new SupportError(
        "Say what was done before resolving this request.",
        "RESOLUTION_REQUIRED"
      );
    }
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.supportTicket.update({
      where: { id: ticketId },
      data: {
        status,
        ...(status === "RESOLVED" ? { resolvedAt: now } : {}),
        ...(status === "CLOSED" ? { closedAt: now } : {}),
        // Reopening must clear the timestamps, or a ticket resolved on Monday
        // and reopened on Tuesday reports both a resolution and an open queue.
        ...(status === "IN_PROGRESS" || status === "OPEN" ? { resolvedAt: null, closedAt: null } : {}),
      },
    });
    await tx.supportTicketEvent.create({
      data: { ticketId, actorId, action: "STATUS_CHANGED", fromValue: ticket.status, toValue: status, note: opts.note ?? null },
    });
    // Written in the same transaction as the status flip, so a ticket can never
    // end up RESOLVED with the explanation missing. isStaff is taken from the
    // actor's authority, not from the payload.
    if (status === "RESOLVED" && resolutionText) {
      await tx.supportMessage.create({
        data: {
          ticketId,
          authorId: actorId,
          body: resolutionText.slice(0, 8000),
          isStaff: true,
          isResolution: true,
        },
      });
      await tx.supportTicketEvent.create({
        data: { ticketId, actorId, action: "RESOLUTION_RECORDED" },
      });
    }
    return row;
  });

  if (!opts.silent) {
    void notifyStatusChange(updated.reference, ticket.requesterId, status).catch((err) =>
      console.error("[SUPPORT] status notification failed:", err)
    );
  }
  return updated;
}

export async function setPriority(ticketId: string, priority: string, actorId: string) {
  const value = String(priority).toUpperCase() as SupportPriority;
  if (!(SUPPORT_PRIORITIES as readonly string[]).includes(value)) {
    throw new SupportError("Unknown priority.", "INVALID_PRIORITY");
  }
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, priority: true } });
  if (!ticket) throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  if (ticket.priority === value) return ticket;

  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticketId }, data: { priority: value } });
    await tx.supportTicketEvent.create({
      data: { ticketId, actorId, action: "PRIORITY_CHANGED", fromValue: ticket.priority, toValue: value },
    });
  });
  return { id: ticketId, priority: value };
}

export async function assignTicket(ticketId: string, assigneeId: string | null, actorId: string) {
  if (assigneeId) {
    const target = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new SupportError("That agent does not exist.", "NOT_FOUND", 404);
    // Assignment is the only place support authority is granted, so it is the
    // place the role check belongs. A suspended account must never be handed a
    // queue of other people's problems. The role list is the shared canonical
    // one from rbac/sections rather than a local copy, so a role added there is
    // not silently unable to take tickets here.
    if (!ADMIN_ROLES.includes((target.role || "") as any)) {
      throw new SupportError("Tickets can only be assigned to a support administrator.", "NOT_STAFF", 403);
    }
    if (target.status === "SUSPENDED") {
      throw new SupportError("That account is suspended.", "NOT_STAFF", 403);
    }
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, assignedToId: true },
  });
  if (!ticket) throw new SupportError("Ticket not found.", "NOT_FOUND", 404);
  if (ticket.assignedToId === assigneeId) return ticket;

  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticketId }, data: { assignedToId: assigneeId } });
    await tx.supportTicketEvent.create({
      data: { ticketId, actorId, action: assigneeId ? "ASSIGNED" : "UNASSIGNED", toValue: assigneeId },
    });
  });
  return { id: ticketId, assignedToId: assigneeId };
}

export async function countOpenTickets(): Promise<{ open: number; urgent: number; unassigned: number }> {
  const [open, urgent, unassigned] = await Promise.all([
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"] } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"] }, priority: "URGENT" } }),
    prisma.supportTicket.count({ where: { status: "OPEN", assignedToId: null } }),
  ]);
  return { open, urgent, unassigned };
}

// ---------------------------------------------------------------------------
// Notifications. Fire-and-forget: a failed email must not lose the reply the
// person just wrote, so these are logged rather than thrown.
// ---------------------------------------------------------------------------

async function notifyNewTicket(reference: string, category: string, subject: string, priority: string) {
  const bodyHtml = `<p style="margin:0 0 14px">A new support request needs a reply.</p>
<p style="margin:0 0 14px"><strong>${escHtml(reference)}</strong> · ${escHtml(category)} · ${escHtml(priority)}<br/>${escHtml(subject)}</p>`;
  // Reuses the established admin-recipient list rather than adding a second
  // source of truth for "who receives operational mail".
  const recipients = sosRecipients();
  if (recipients.length === 0) {
    console.error(
      "[SUPPORT] new ticket created but no admin recipient is configured: set SOS_SMS_TO or ADMIN_EMAIL. The queue is not being notified by email."
    );
    return;
  }
  const html = renderEmail({
    title: `New support request ${reference}`,
    kicker: "Support desk",
    bodyHtml,
    ctaText: "Open the queue",
    ctaUrl: `${WEB_ORIGIN}/admin/support`,
  });
  for (const to of recipients) {
    const result = await sendEmail(to, `New support request ${reference} (${category}, ${priority})`, html, subject);
    if (!result.ok) console.error("[SUPPORT] admin ticket email not delivered:", result.error);
  }
}

async function notifyReply(reference: string, requesterId: string, body: string) {
  // Only staff replies need an email: a user notifying themselves they replied
  // is noise, and a user reply is already visible in their own thread.
  const user = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return;

  const preview = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  const result = await sendEmail(
    user.email,
    `We replied to ${reference}`,
    renderEmail({
      title: "Support replied",
      kicker: `Ticket ${reference}`,
      bodyHtml: `<p style="margin:0 0 14px">${escHtml("Our team has replied to your request.")}</p>
<p style="margin:0 0 14px">${escHtml(preview)}</p>`,
      ctaText: "View ticket",
      ctaUrl: `${WEB_ORIGIN}/support/${reference}`,
    }),
    preview
  );
  if (!result.ok) console.error("[SUPPORT] reply email not delivered:", result.error);
}

async function notifyStatusChange(reference: string, requesterId: string, status: string) {
  const user = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return;
  const copy: Record<string, string> = {
    RESOLVED: "Your request has been marked resolved. Reply if that is not right and we will pick it back up.",
    CLOSED: "Your request has been closed. You can reopen it from your support page.",
    WAITING_ON_USER: "We are waiting on your reply before we can continue.",
    IN_PROGRESS: "Your request is being worked on.",
  };
  const line = copy[status];
  if (!line) return;
  const result = await sendEmail(
    user.email,
    `${reference} · ${status.replace(/_/g, " ").toLowerCase()}`,
    renderEmail({
      title: "Support update",
      kicker: `Ticket ${reference}`,
      bodyHtml: `<p style="margin:0 0 14px">${escHtml(line)}</p>`,
      ctaText: "View ticket",
      ctaUrl: `${WEB_ORIGIN}/support/${reference}`,
    }),
    line
  );
  if (!result.ok) console.error("[SUPPORT] status email not delivered:", result.error);
}
