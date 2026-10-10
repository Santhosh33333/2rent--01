import { describe, it, expect } from "vitest";
import {
  routeMessage,
  composeRuleReply,
  ruleHelp,
  ruleSuggestions,
  extractCity,
  type RuleActivity,
} from "../agent/ruleRouter";

/**
 * The offline assistant (no LLM provider) routes a message to one read-only tool
 * and reports the tool's real data. These tests pin the routing decisions and the
 * "never invent" property of the reply, which are the whole safety story for the
 * keyless mode.
 */

const USER = new Set([
  "get_my_profile",
  "get_my_subscription",
  "get_my_requests",
  "get_active_request",
  "search_partners",
  "search_events",
  "search_communities",
  "get_event",
  "get_notifications",
  "get_payment_history",
  "get_wallet",
  "get_support_information",
]);

const PARTNER = new Set([
  ...USER,
  "get_my_earnings",
  "get_my_partner_status",
  "get_my_withdrawals",
  "request_withdrawal",
]);

const ADMIN = new Set([
  ...PARTNER,
  "admin_get_platform_stats",
  "admin_find_user",
  "admin_list_withdrawals",
  "admin_approve_withdrawal",
]);

describe("routeMessage — user reads", () => {
  it("routes a wallet question to get_wallet", () => {
    const r = routeMessage("what is my wallet balance?", USER);
    expect(r.calls).toEqual([{ toolName: "get_wallet", args: { limit: 5 } }]);
  });

  it("routes a payments question to get_payment_history", () => {
    expect(routeMessage("show my recent payments", USER).calls[0].toolName).toBe(
      "get_payment_history",
    );
  });

  it("routes bookings to get_my_requests", () => {
    expect(routeMessage("show my bookings", USER).calls[0].toolName).toBe("get_my_requests");
  });

  it("routes an active request question to get_active_request", () => {
    expect(routeMessage("do I have an active request?", USER).calls[0].toolName).toBe(
      "get_active_request",
    );
  });

  it("sets unreadOnly when the user says unread", () => {
    const r = routeMessage("any unread notifications?", USER);
    expect(r.calls[0]).toEqual({ toolName: "get_notifications", args: { unreadOnly: true, limit: 10 } });
  });

  it("routes a subscription question", () => {
    expect(routeMessage("when does my plan expire?", USER).calls[0].toolName).toBe(
      "get_my_subscription",
    );
  });

  it("routes a profile/verification question", () => {
    expect(routeMessage("am I verified?", USER).calls[0].toolName).toBe("get_my_profile");
  });

  it("routes a support question", () => {
    expect(routeMessage("I want to contact support", USER).calls[0].toolName).toBe(
      "get_support_information",
    );
  });

  it("routes communities", () => {
    expect(routeMessage("show me communities", USER).calls[0].toolName).toBe("search_communities");
  });
});

describe("routeMessage — discovery with extracted entities", () => {
  it("extracts a city and service for a partner search", () => {
    const r = routeMessage("find a walking partner in Pune", USER);
    expect(r.calls[0].toolName).toBe("search_partners");
    expect(r.calls[0].args).toMatchObject({ city: "Pune", service: "walking" });
  });

  it("detects a carry request", () => {
    const r = routeMessage("I need someone to carry my luggage", USER);
    expect(r.calls[0].toolName).toBe("search_partners");
    expect(r.calls[0].args.service).toBe("carry");
  });

  it("maps sports words to the sports category", () => {
    const r = routeMessage("any cricket events this weekend?", USER);
    expect(r.calls[0].toolName).toBe("search_events");
    expect(r.calls[0].args).toMatchObject({ category: "sports", query: "cricket" });
  });

  it("maps movie words to the movies category", () => {
    expect(routeMessage("movie events near me", USER).calls[0].args.category).toBe("movies");
  });

  it("does not mistake 'near me' for a city", () => {
    expect(extractCity("partners near me")).toBeUndefined();
  });

  it("reads a city from anywhere in the message", () => {
    expect(extractCity("partners in Bengaluru tonight")).toBe("Bengaluru");
  });
});

describe("routeMessage — role gating", () => {
  it("hides partner tools from a plain user", () => {
    expect(routeMessage("how much did I earn today?", USER).calls).toHaveLength(0);
  });

  it("routes partner earnings for a partner", () => {
    expect(routeMessage("how much did I earn this week?", PARTNER).calls[0].toolName).toBe(
      "get_my_earnings",
    );
  });

  it("routes withdrawal history for a partner", () => {
    expect(routeMessage("show my withdrawal history", PARTNER).calls[0].toolName).toBe(
      "get_my_withdrawals",
    );
  });

  it("only offers admin tools to an admin", () => {
    expect(routeMessage("platform stats", USER).calls).toHaveLength(0);
    expect(routeMessage("platform stats", ADMIN).calls[0].toolName).toBe("admin_get_platform_stats");
  });

  it("passes a real email to admin_find_user, not a free-text query", () => {
    const r = routeMessage("look up user santhosh@example.com", ADMIN);
    expect(r.calls[0]).toEqual({ toolName: "admin_find_user", args: { email: "santhosh@example.com" } });
  });
});

describe("routeMessage — actions are guided, never auto-run", () => {
  it("guides a booking instead of creating it", () => {
    const r = routeMessage("book a walk for me", USER);
    expect(r.calls).toHaveLength(0);
    expect(r.guidance).toMatch(/Bookings/i);
  });

  it("guides a cancellation", () => {
    const r = routeMessage("cancel my booking", USER);
    expect(r.calls).toHaveLength(0);
    expect(r.guidance).toMatch(/cancel/i);
  });

  it("falls back to help when nothing matches", () => {
    const r = routeMessage("hello there", USER);
    expect(r.calls).toHaveLength(0);
    expect(r.guidance).toBeUndefined();
    expect(ruleHelp(USER)).toMatch(/events/i);
  });
});

describe("composeRuleReply — grounded output", () => {
  it("quotes the wallet balance from the payload", () => {
    const msg = composeRuleReply([
      {
        toolName: "get_wallet",
        status: "success",
        summary: "ok",
        data: { wallet: { balance: 250, currency: "INR", promotionalBalance: 0, heldBalance: 0 }, transactions: [] },
      },
    ]);
    expect(msg).toContain("₹250.00");
  });

  it("reports an empty event search as empty, not as invented events", () => {
    const msg = composeRuleReply([
      { toolName: "search_events", status: "success", summary: "", data: { events: [] } },
    ]);
    expect(msg).toMatch(/couldn't find any published events/i);
  });

  it("surfaces a failed tool's own message", () => {
    const msg = composeRuleReply([
      { toolName: "search_partners", status: "failed", summary: "I need your location permission, or a city name." },
    ]);
    expect(msg).toBe("I need your location permission, or a city name.");
  });

  it("suggests grounded follow-ups", () => {
    const activity: RuleActivity[] = [
      { toolName: "get_wallet", status: "success", summary: "ok", data: {} },
    ];
    const s = ruleSuggestions(activity);
    expect(s).toContain("Show my payment history");
    expect(s.length).toBeLessThanOrEqual(3);
  });
});
