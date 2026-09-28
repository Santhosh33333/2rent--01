import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";

// Bootstrapped inline, before the service graph is imported, because
// supportService -> emailService -> config/env validates DATABASE_URL at import
// time. Same convention as legalReConsent.test.ts.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';

/**
 * The support lifecycle is mostly authorisation rules, so they are asserted as
 * rules rather than through HTTP. Every case below is a way a support desk
 * normally leaks private data or fakes its own health metrics.
 */
const state = {
  tickets: new Map<string, any>(),
  messages: [] as any[],
  events: [] as any[],
  users: new Map<string, any>(),
  resolutions: new Map<string, any>(),
};

const txStub = {
  supportTicket: {
    update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
  },
  supportMessage: { create: vi.fn(async ({ data }: any) => ({ id: "m1", ...data })) },
  supportTicketEvent: { create: vi.fn(async ({ data }: any) => ({ id: "e1", ...data })) },
};

vi.mock("../config/database", () => ({
  prisma: {
    supportTicket: {
      findUnique: vi.fn(async ({ where }: any) => state.tickets.get(where.id) ?? null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    supportMessage: {
      create: vi.fn(async ({ data }: any) => ({ id: "m1", ...data })),
      // Drives the "has somebody actually said what they did?" check.
      findFirst: vi.fn(async ({ where }: any) => state.resolutions.get(where.ticketId) ?? null),
    },
    supportTicketEvent: { create: vi.fn(async ({ data }: any) => ({ id: "e1", ...data })) },
    user: { findUnique: vi.fn(async ({ where }: any) => state.users.get(where.id) ?? null) },
    // The service does its lifecycle writes on the transaction client, so the
    // stub has to expose the same models `tx` does.
    $transaction: vi.fn(async (fn: any) => fn(txStub)),
  },
}));

// Imported in beforeAll rather than at the top level: the module graph is
// CommonJS here, so a top-level await would not compile. Mirrors the pattern in
// legalReConsent.test.ts.
type SupportModule = typeof import("../services/supportService.js");
let transitionStatus: SupportModule["transitionStatus"];
let addReply: SupportModule["addReply"];
let assignTicket: SupportModule["assignTicket"];
let SupportError: SupportModule["SupportError"];

beforeAll(async () => {
  const svc: SupportModule = await import("../services/supportService.js");
  ({ transitionStatus, addReply, assignTicket, SupportError } = svc);
});

const REQUESTER = "user-1";
const STRANGER = "user-2";
const AGENT = "admin-1";

function seed(status: string, overrides: Record<string, any> = {}) {
  const ticket = {
    id: "t1",
    reference: "NBR-TEST01",
    requesterId: REQUESTER,
    status,
    subject: "Payment not credited",
    assignedToId: null,
    firstResponseAt: null,
    ...overrides,
  };
  state.tickets.set(ticket.id, ticket);
  return ticket;
}

beforeEach(() => {
  state.tickets.clear();
  state.messages.length = 0;
  state.events.length = 0;
  state.users.clear();
  state.resolutions.clear();
  vi.clearAllMocks();
});

async function expectError(promise: Promise<unknown>, code: string, status?: number) {
  await expect(promise).rejects.toBeInstanceOf(SupportError);
  const err = await promise.then(
    () => null,
    (e: any) => e
  );
  expect(err.code).toBe(code);
  if (status !== undefined) expect(err.status).toBe(status);
}

describe("support ticket status authorisation", () => {
  it("refuses to let a requester mark their own ticket resolved", async () => {
    seed("IN_PROGRESS");
    // The core integrity rule: "resolved" claims the problem is fixed, and that
    // must never be assertable by whoever reported it.
    await expectError(transitionStatus("t1", "RESOLVED", REQUESTER, false), "FORBIDDEN_TRANSITION", 403);
  });

  it("refuses to let a requester put a fresh ticket into a staff-owned state", async () => {
    seed("OPEN");
    await expectError(transitionStatus("t1", "IN_PROGRESS", REQUESTER, false), "FORBIDDEN_TRANSITION", 403);
    await expectError(transitionStatus("t1", "WAITING_ON_USER", REQUESTER, false), "FORBIDDEN_TRANSITION", 403);
    await expectError(transitionStatus("t1", "RESOLVED", REQUESTER, false), "FORBIDDEN_TRANSITION", 403);
  });

  it("lets a requester close their own ticket", async () => {
    seed("OPEN");
    await expect(transitionStatus("t1", "CLOSED", REQUESTER, false)).resolves.toBeTruthy();
  });

  it("hides a ticket from a user who does not own it", async () => {
    seed("OPEN");
    // 404 rather than 403: confirming a ticket id exists is itself a leak.
    await expectError(transitionStatus("t1", "CLOSED", STRANGER, false), "NOT_FOUND", 404);
  });

  it("lets staff resolve a ticket when they say what was done", async () => {
    seed("IN_PROGRESS");
    await expect(transitionStatus("t1", "RESOLVED", AGENT, true, { resolution: "Refunded." })).resolves.toBeTruthy();
  });

  it("blocks a transition that the state machine forbids even for staff", async () => {
    seed("CLOSED");
    // A closed ticket must be reopened before it can be resolved again.
    await expectError(transitionStatus("t1", "RESOLVED", AGENT, true), "INVALID_TRANSITION", 409);
  });

  it("lets staff resolve straight from WAITING_ON_USER", async () => {
    // The real flow is: agent replies -> user answers -> agent resolves. Blocking
    // this would force a meaningless extra state change on every ticket.
    seed("WAITING_ON_USER");
    await expect(
      transitionStatus("t1", "RESOLVED", AGENT, true, { resolution: "Refund issued and confirmed." })
    ).resolves.toBeTruthy();
  });

  it("refuses to resolve without saying what was done", async () => {
    seed("IN_PROGRESS");
    // Otherwise a queue can be cleared with one click and the response metrics
    // look healthy while the requester was never told anything.
    await expectError(transitionStatus("t1", "RESOLVED", AGENT, true), "RESOLUTION_REQUIRED");
  });

  it("accepts a resolution once a resolution message already exists", async () => {
    seed("IN_PROGRESS");
    state.resolutions.set("t1", { id: "m0" });
    await expect(transitionStatus("t1", "RESOLVED", AGENT, true)).resolves.toBeTruthy();
  });

  it("writes the resolution message in the same transaction as the status flip", async () => {
    seed("IN_PROGRESS");
    await transitionStatus("t1", "RESOLVED", AGENT, true, { resolution: "Refund issued." });
    const data = txStub.supportMessage.create.mock.calls.at(-1)![0].data;
    expect(data.isResolution).toBe(true);
    expect(data.isStaff).toBe(true);
    expect(data.body).toBe("Refund issued.");
  });

  it("rejects an unknown status instead of writing it to the row", async () => {
    seed("OPEN");
    await expectError(transitionStatus("t1", "BANANA", AGENT, true), "INVALID_STATUS");
  });

  it("is idempotent for a no-op transition", async () => {
    seed("OPEN");
    await expect(transitionStatus("t1", "OPEN", AGENT, true)).resolves.toBeTruthy();
  });
});

describe("support replies", () => {
  it("refuses a reply to a closed ticket rather than silently discarding it", async () => {
    seed("CLOSED");
    await expectError(
      addReply({ ticketId: "t1", authorId: AGENT, authorIsStaff: true, body: "hello" }),
      "TICKET_CLOSED",
      409
    );
  });

  it("refuses a user replying on a ticket they do not own", async () => {
    seed("OPEN");
    await expectError(
      addReply({ ticketId: "t1", authorId: STRANGER, authorIsStaff: false, body: "hello there" }),
      "NOT_FOUND",
      404
    );
  });

  it("stamps isStaff from the actor's authority, not the request body", async () => {
    seed("OPEN");
    // The owner replying: their message must be persisted as non-staff, because
    // the flag is derived from the session role rather than anything sent.
    await addReply({ ticketId: "t1", authorId: REQUESTER, authorIsStaff: false, body: "hi" });
    const data = txStub.supportMessage.create.mock.calls.at(-1)![0].data;
    expect(data.isStaff).toBe(false);
    expect(data.authorId).toBe(REQUESTER);
  });

  it("stamps isStaff true only when the session says the author is staff", async () => {
    seed("OPEN");
    await addReply({ ticketId: "t1", authorId: AGENT, authorIsStaff: true, body: "on it" });
    const data = txStub.supportMessage.create.mock.calls.at(-1)![0].data;
    expect(data.isStaff).toBe(true);
  });

  it("rejects an empty message", async () => {
    seed("OPEN");
    await expectError(
      addReply({ ticketId: "t1", authorId: REQUESTER, authorIsStaff: false, body: "   " }),
      "INVALID_BODY"
    );
  });
});

describe("support assignment", () => {
  it("refuses to assign a ticket to a non-staff account", async () => {
    seed("OPEN");
    state.users.set(STRANGER, { id: STRANGER, role: "USER", status: "ACTIVE" });
    // The only place support authority is granted, so the role gate lives here.
    await expectError(assignTicket("t1", STRANGER, AGENT), "NOT_STAFF", 403);
  });

  it("refuses to assign a ticket to a suspended admin", async () => {
    seed("OPEN");
    state.users.set(STRANGER, { id: STRANGER, role: "ADMIN", status: "SUSPENDED" });
    await expectError(assignTicket("t1", STRANGER, AGENT), "NOT_STAFF", 403);
  });

  it("allows unassigning to clear the queue", async () => {
    seed("OPEN", { assignedToId: AGENT });
    await expect(assignTicket("t1", null, AGENT)).resolves.toEqual({ id: "t1", assignedToId: null });
  });
});
