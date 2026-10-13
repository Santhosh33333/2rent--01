/**
 * Metered-call wiring tests for the socket call handlers.
 *
 * `callBillingService` is mocked here on purpose: its own money behaviour is
 * covered against a real database in callBilling.test.ts. What these tests pin
 * down is the wiring in callService - that the price is checked before ringing,
 * that the reservation is taken at accept, that a failed reservation does not
 * connect the call, and that a connected call is settled while a missed one is
 * released. Those are the places a mistake would either charge for nothing or
 * leak a reservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const billing = vi.hoisted(() => {
  class BillingError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 402) {
      super(message);
      this.name = "BillingError";
      this.code = code;
      this.status = status;
    }
  }
  return {
    BillingError,
    getCallTerms: vi.fn(),
    holdForCall: vi.fn(),
    settleCall: vi.fn(),
    releaseHold: vi.fn(),
    isExemptFromCallBilling: vi.fn(),
    getSpendableBalance: vi.fn(),
  };
});

const db = vi.hoisted(() => ({
  userBlockFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  callLogCreate: vi.fn(),
  callLogUpdate: vi.fn(),
}));

const live = vi.hoisted(() => ({
  putLiveCall: vi.fn(),
  getLiveCall: vi.fn(),
  updateLiveCall: vi.fn(),
  dropLiveCall: vi.fn(),
  listLiveCallIds: vi.fn(),
  isUserOnlineShared: vi.fn(),
}));

vi.mock("../services/callBillingService", () => ({
  getCallTerms: billing.getCallTerms,
  holdForCall: billing.holdForCall,
  settleCall: billing.settleCall,
  releaseHold: billing.releaseHold,
  isExemptFromCallBilling: billing.isExemptFromCallBilling,
  getSpendableBalance: billing.getSpendableBalance,
  BillingError: billing.BillingError,
}));

vi.mock("../config/database", () => ({
  prisma: {
    userBlock: { findFirst: db.userBlockFindFirst },
    user: { findUnique: db.userFindUnique },
    callLog: { create: db.callLogCreate, update: db.callLogUpdate },
  },
}));

vi.mock("../services/redisClient", () => ({
  putLiveCall: live.putLiveCall,
  getLiveCall: live.getLiveCall,
  updateLiveCall: live.updateLiveCall,
  dropLiveCall: live.dropLiveCall,
  listLiveCallIds: live.listLiveCallIds,
  isUserOnlineShared: live.isUserOnlineShared,
}));

vi.mock("../services/notificationService", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import { registerCallHandlers } from "../services/callService";

const ME = "user-me";
const THEM = "user-them";

const TERMS = { ratePerMinute: 1, maxBillableMinutes: 60, enabled: true };

function makeSocket() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const socket: any = {
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    },
    emit: vi.fn(),
  };
  return { handlers, socket };
}

function unavailable(socket: any) {
  return socket.emit.mock.calls.find((call: any[]) => call[0] === "call:unavailable");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.userBlockFindFirst.mockResolvedValue(null);
  db.userFindUnique.mockResolvedValue({ id: THEM, fullName: "Asha", avatarUrl: null });
  db.callLogCreate.mockResolvedValue({ id: "call-1" });
  db.callLogUpdate.mockResolvedValue({});
  live.listLiveCallIds.mockResolvedValue([]);
  live.isUserOnlineShared.mockResolvedValue(false);
  billing.getCallTerms.mockResolvedValue({ ...TERMS });
  billing.isExemptFromCallBilling.mockResolvedValue(false);
  billing.getSpendableBalance.mockResolvedValue({ balance: 100, held: 0, available: 100 });
  billing.holdForCall.mockResolvedValue({ heldAmount: 60 });
  billing.settleCall.mockResolvedValue(null);
  billing.releaseHold.mockResolvedValue(null);
});

describe("affordability before ringing", () => {
  it("refuses the invite when the caller cannot cover the reservation", async () => {
    billing.getSpendableBalance.mockResolvedValue({ balance: 10, held: 0, available: 10 });
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:invite"]({ receiverId: THEM, type: "VOICE" });
    await vi.waitFor(() => expect(unavailable(socket)).toBeDefined());

    expect(unavailable(socket)![1]).toMatchObject({
      reason: "INSUFFICIENT_BALANCE",
      required: 60,
      available: 10,
    });
    // The phone never rings and no ledger row is created.
    expect(db.callLogCreate).not.toHaveBeenCalled();
  });

  it("rings when the caller can cover the reservation", async () => {
    const { handlers, socket } = makeSocket();
    const emitToPeer = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToPeer, () => false);

    handlers["call:invite"]({ receiverId: THEM, type: "VIDEO" });
    await vi.waitFor(() => expect(db.callLogCreate).toHaveBeenCalled());

    expect(emitToPeer).toHaveBeenCalledWith(THEM, "call:incoming", expect.objectContaining({ type: "VIDEO" }));
  });

  it("rings an exempt account without checking its balance", async () => {
    billing.isExemptFromCallBilling.mockResolvedValue(true);
    const { handlers, socket } = makeSocket();
    const emitToPeer = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToPeer, () => false);

    handlers["call:invite"]({ receiverId: THEM, type: "VOICE" });
    await vi.waitFor(() => expect(db.callLogCreate).toHaveBeenCalled());

    expect(billing.getSpendableBalance).not.toHaveBeenCalled();
  });

  it("skips all billing when metered calling is switched off", async () => {
    billing.getCallTerms.mockResolvedValue({ ...TERMS, enabled: false });
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:invite"]({ receiverId: THEM, type: "VOICE" });
    await vi.waitFor(() => expect(db.callLogCreate).toHaveBeenCalled());

    expect(billing.getSpendableBalance).not.toHaveBeenCalled();
    expect(billing.isExemptFromCallBilling).not.toHaveBeenCalled();
  });
});

describe("reservation at accept", () => {
  function ringingCall(overrides: Record<string, unknown> = {}) {
    return { id: "call-1", callerId: THEM, receiverId: ME, type: "VOICE", startedAt: 0, ...overrides };
  }

  it("takes the hold and connects the call", async () => {
    live.getLiveCall.mockResolvedValue(ringingCall());
    const { handlers, socket } = makeSocket();
    const emitToPeer = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToPeer, () => false);

    handlers["call:accept"]({ callId: "call-1" });
    await vi.waitFor(() => expect(billing.holdForCall).toHaveBeenCalled());

    expect(billing.holdForCall).toHaveBeenCalledWith({
      callId: "call-1",
      callerId: THEM,
      receiverId: ME,
      terms: expect.objectContaining({ enabled: true }),
    });
    expect(emitToPeer).toHaveBeenCalledWith(THEM, "call:accepted", expect.objectContaining({ callId: "call-1" }));
  });

  it("does not connect the call when the reservation fails", async () => {
    live.getLiveCall.mockResolvedValue(ringingCall());
    billing.holdForCall.mockRejectedValue(new billing.BillingError("INSUFFICIENT_FUNDS", "Not enough balance."));
    const { handlers, socket } = makeSocket();
    const emitToPeer = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToPeer, () => false);

    handlers["call:accept"]({ callId: "call-1" });
    await vi.waitFor(() => expect(unavailable(socket)).toBeDefined());

    expect(unavailable(socket)![1]).toMatchObject({ reason: "INSUFFICIENT_FUNDS" });
    // Neither side sees an accepted call, and the ledger is marked FAILED.
    expect(emitToPeer).not.toHaveBeenCalledWith(THEM, "call:accepted", expect.anything());
    expect(db.callLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "call-1" }, data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("does not hold for an exempt account", async () => {
    billing.isExemptFromCallBilling.mockResolvedValue(true);
    live.getLiveCall.mockResolvedValue(ringingCall());
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:accept"]({ callId: "call-1" });
    await vi.waitFor(() => expect(db.callLogUpdate).toHaveBeenCalled());

    expect(billing.holdForCall).not.toHaveBeenCalled();
  });
});

describe("settlement on end", () => {
  it("settles a connected call for its minutes", async () => {
    live.getLiveCall.mockResolvedValue({
      id: "call-1",
      callerId: ME,
      receiverId: THEM,
      type: "VOICE",
      startedAt: Date.now() - 65_000,
    });
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:end"]({ callId: "call-1" });
    await vi.waitFor(() => expect(billing.settleCall).toHaveBeenCalled());

    expect(billing.settleCall).toHaveBeenCalledWith("call-1", "CLIENT_END");
  });

  it("does not settle a call that was never answered", async () => {
    live.getLiveCall.mockResolvedValue({
      id: "call-1",
      callerId: ME,
      receiverId: THEM,
      type: "VOICE",
      startedAt: 0,
    });
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:end"]({ callId: "call-1" });
    await vi.waitFor(() => expect(db.callLogUpdate).toHaveBeenCalled());

    expect(billing.settleCall).not.toHaveBeenCalled();
  });

  it("releases (never charges) a rejected call", async () => {
    live.getLiveCall.mockResolvedValue({
      id: "call-1",
      callerId: THEM,
      receiverId: ME,
      type: "VOICE",
      startedAt: 0,
    });
    const { handlers, socket } = makeSocket();
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers["call:reject"]({ callId: "call-1" });
    await vi.waitFor(() => expect(billing.releaseHold).toHaveBeenCalled());

    expect(billing.releaseHold).toHaveBeenCalledWith("call-1", "ABANDONED");
    expect(billing.settleCall).not.toHaveBeenCalled();
  });
});
