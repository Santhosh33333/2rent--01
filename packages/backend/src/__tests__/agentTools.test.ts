import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import {
  __resetRegistryForTests,
  registerTool,
  listToolsForRole,
  toolSchemasForRole,
  type AgentToolContext,
} from "../agent/toolRegistry";
import {
  __resetConfirmationsForTests,
  runAgentTool,
  setAuditSink,
  type AgentAuditRow,
} from "../agent/toolRouter";
import { AgentToolError } from "../agent/toolRegistry";

/**
 * Security tests for the agent tool layer.
 *
 * These assert the guarantees the agent depends on: unknown tools are denied,
 * permissions are enforced server-side, mutating tools cannot run without an
 * exact-match confirmation, confirmations are single-use and non-transferable,
 * and every attempt is audited.
 */

const noArgs = z.object({}).strict();

function ctxFor(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    userId: "user-1",
    role: "USER",
    accountRole: "USER",
    isAdminTier: false,
    sessionId: "sess-1",
    ...overrides,
  };
}

const readTool = () =>
  registerTool({
    name: "read_thing",
    description: "test read",
    inputSchema: noArgs,
    permission: "user",
    confirmationRequired: false,
    category: "support",
    handler: async () => ({ ok: true }),
  });

const writeTool = () =>
  registerTool({
    name: "write_thing",
    description: "test write",
    inputSchema: z.object({ targetId: z.string().min(1), amount: z.number().positive() }).strict(),
    permission: "user",
    confirmationRequired: true,
    category: "requests",
    confirmationSummary: (a) => `Write to ${a.targetId} for ${a.amount}`,
    handler: async () => ({ written: true }),
  });

const adminTool = () =>
  registerTool({
    name: "admin_thing",
    description: "test admin",
    inputSchema: noArgs,
    permission: "admin",
    confirmationRequired: false,
    category: "admin",
    handler: async () => ({ admin: true }),
  });

describe("agent tool registry", () => {
  let audit: AgentAuditRow[];

  beforeEach(() => {
    __resetRegistryForTests();
    __resetConfirmationsForTests();
    audit = [];
    setAuditSink((row) => {
      audit.push(row);
    });
  });

  afterEach(() => {
    setAuditSink(() => {});
    vi.restoreAllMocks();
  });

  it("denies a tool name that is not registered instead of executing it", async () => {
    readTool();
    const outcome = await runAgentTool(ctxFor(), { toolName: "drop_database", args: {} });
    expect(outcome.status).toBe("denied");
    if (outcome.status !== "denied") throw new Error("expected denied");
    expect(outcome.code).toBe("TOOL_NOT_FOUND");
    expect(audit.at(-1)?.errorCode).toBe("TOOL_NOT_FOUND");
  });

  it("refuses to register the same tool name twice", () => {
    readTool();
    expect(() => readTool()).toThrow(/already registered/);
  });

  it("blocks a normal user from calling an admin tool", async () => {
    adminTool();
    const outcome = await runAgentTool(ctxFor(), { toolName: "admin_thing", args: {} });
    expect(outcome.status).toBe("denied");
    if (outcome.status !== "denied") throw new Error("expected denied");
    expect(outcome.code).toBe("TOOL_FORBIDDEN");
  });

  it("blocks a normal user from admin tools even when they guess the name", async () => {
    adminTool();
    const outcome = await runAgentTool(ctxFor({ role: "USER", accountRole: "USER", isAdminTier: false }), {
      toolName: "admin_thing",
      args: {},
    });
    if (outcome.status !== "denied") throw new Error("expected denied");
    expect(outcome.code).toBe("TOOL_FORBIDDEN");
  });

  it("does not expose admin tools in the schema list given to the model", () => {
    readTool();
    adminTool();
    const forUser = toolSchemasForRole("USER", false).map((t) => t.function.name);
    expect(forUser).toContain("read_thing");
    expect(forUser).not.toContain("admin_thing");

    const forAdmin = toolSchemasForRole("SUPER_ADMIN", true).map((t) => t.function.name);
    expect(forAdmin).toContain("admin_thing");
  });

  it("hides partner-only tools from plain users", () => {
    registerTool({
      name: "partner_thing",
      description: "test partner",
      inputSchema: noArgs,
      permission: "partner",
      confirmationRequired: false,
      category: "partner",
      handler: async () => ({ p: true }),
    });
    expect(listToolsForRole("USER", false).map((t) => t.name)).not.toContain("partner_thing");
    expect(listToolsForRole("PARTNER", false).map((t) => t.name)).toContain("partner_thing");
  });

  it("rejects arguments that fail the tool's schema and does not run the handler", async () => {
    const spy = vi.fn(async () => ({ written: true }));
    registerTool({
      name: "strict_tool",
      description: "test",
      inputSchema: z.object({ count: z.number().int().min(1).max(5) }).strict(),
      permission: "user",
      confirmationRequired: false,
      category: "support",
      handler: spy,
    });
    const outcome = await runAgentTool(ctxFor(), { toolName: "strict_tool", args: { count: 999 } });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.code).toBe("TOOL_BAD_INPUT");
    expect(spy).not.toHaveBeenCalled();
  });

  describe("confirmation enforcement", () => {
    it("does not run a mutating tool until a confirmation is supplied", async () => {
      const spy = vi.fn(async () => ({ written: true }));
      registerTool({
        name: "danger",
        description: "test",
        inputSchema: z.object({ targetId: z.string() }).strict(),
        permission: "user",
        confirmationRequired: true,
        category: "requests",
        handler: spy,
      });

      const first = await runAgentTool(ctxFor(), { toolName: "danger", args: { targetId: "abc" } });
      expect(first.status).toBe("confirmation_required");
      expect(spy).not.toHaveBeenCalled();

      const confirmed = await runAgentTool(ctxFor(), {
        toolName: "danger",
        args: { targetId: "abc" },
        confirmationToken: (first as any).confirmation.token,
      });
      expect(confirmed.status).toBe("success");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("returns a confirmation payload describing the resolved action", async () => {
      writeTool();
      const outcome = await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 500 },
      });
      expect(outcome.status).toBe("confirmation_required");
      const c = (outcome as any).confirmation;
      expect(c.summary).toContain("req-1");
      expect(c.summary).toContain("500");
      expect(c.args).toEqual({ targetId: "req-1", amount: 500 });
    });

    it("refuses a confirmation token that belongs to a different user", async () => {
      writeTool();
      const first = await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 10 },
      });
      const token = (first as any).confirmation.token;

      const outcome = await runAgentTool(ctxFor({ userId: "attacker" }), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 10 },
        confirmationToken: token,
      });
      expect(outcome.status).toBe("denied");
      if (outcome.status !== "denied") throw new Error("expected denied");
      expect(outcome.code).toBe("CONFIRMATION_WRONG_USER");
    });

    it("cannot reuse a confirmation for different arguments", async () => {
      const spy = vi.fn(async () => ({ written: true }));
      registerTool({
        name: "danger",
        description: "test",
        inputSchema: z.object({ targetId: z.string(), amount: z.number() }).strict(),
        permission: "user",
        confirmationRequired: true,
        category: "requests",
        handler: spy,
      });
      const first = await runAgentTool(ctxFor(), {
        toolName: "danger",
        args: { targetId: "req-1", amount: 10 },
      });
      const token = (first as any).confirmation.token;

      // Same token, larger amount: the user confirmed ₹10, not ₹10000.
      const outcome = await runAgentTool(ctxFor(), {
        toolName: "danger",
        args: { targetId: "req-1", amount: 10000 },
        confirmationToken: token,
      });
      expect(outcome.status).toBe("denied");
      if (outcome.status !== "denied") throw new Error("expected denied");
      expect(outcome.code).toBe("CONFIRMATION_ARGS_CHANGED");
      expect(spy).not.toHaveBeenCalled();
    });

    it("cannot reuse a confirmation twice", async () => {
      writeTool();
      const first = await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 10 },
      });
      const token = (first as any).confirmation.token;
      await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 10 },
        confirmationToken: token,
      });
      const second = await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-1", amount: 10 },
        confirmationToken: token,
      });
      expect(second.status).toBe("denied");
      if (second.status !== "denied") throw new Error("expected denied");
      expect(second.code).toBe("CONFIRMATION_USED");
    });

    it("never executes a read-only tool behind a confirmation", async () => {
      const spy = vi.fn(async () => ({ ok: true }));
      registerTool({
        name: "plain_read",
        description: "test",
        inputSchema: noArgs,
        permission: "user",
        confirmationRequired: false,
        category: "support",
        handler: spy,
      });
      const outcome = await runAgentTool(ctxFor(), { toolName: "plain_read", args: {} });
      expect(outcome.status).toBe("success");
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("audit logging", () => {
    it("records every field the agent audit spec requires on success", async () => {
      readTool();
      await runAgentTool(ctxFor({ ip: "1.2.3.4", userAgent: "vitest" }), {
        toolName: "read_thing",
        args: {},
      });
      const row = audit.at(-1)!;
      expect(row.userId).toBe("user-1");
      expect(row.sessionId).toBe("sess-1");
      expect(row.toolName).toBe("read_thing");
      expect(row.permission).toBe("user");
      expect(row.confirmationRequired).toBe(false);
      expect(row.confirmationStatus).toBe("not_required");
      expect(row.result).toBe("success");
      expect(row.errorCode).toBeUndefined();
      expect(row.ip).toBe("1.2.3.4");
    });

    it("records the denied attempt when a user reaches for an admin tool", async () => {
      adminTool();
      await runAgentTool(ctxFor(), { toolName: "admin_thing", args: {} });
      const row = audit.at(-1)!;
      expect(row.result).toBe("denied");
      expect(row.errorCode).toBe("TOOL_FORBIDDEN");
      expect(row.isAdminAction).toBe(false);
    });

    it("records a confirmation request then a confirmed execution", async () => {
      writeTool();
      const first = await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-9", amount: 25 },
      });
      expect(audit.at(-1)!.confirmationStatus).toBe("requested");
      expect(audit.at(-1)!.result).toBe("denied");

      await runAgentTool(ctxFor(), {
        toolName: "write_thing",
        args: { targetId: "req-9", amount: 25 },
        confirmationToken: (first as any).confirmation.token,
      });
      expect(audit.at(-1)!.confirmationStatus).toBe("confirmed");
      expect(audit.at(-1)!.result).toBe("success");
    });

    it("flags a successful admin tool call as an admin action", async () => {
      adminTool();
      await runAgentTool(
        ctxFor({ role: "SUPER_ADMIN", accountRole: "SUPER_ADMIN", isAdminTier: true }),
        { toolName: "admin_thing", args: {} }
      );
      const row = audit.at(-1)!;
      expect(row.result).toBe("success");
      expect(row.isAdminAction).toBe(true);
    });
  });

  it("surfaces a tool failure honestly instead of reporting success", async () => {
    registerTool({
      name: "flaky",
      description: "test",
      inputSchema: noArgs,
      permission: "user",
      confirmationRequired: false,
      category: "support",
      handler: async () => {
        throw new AgentToolError("The payment service is unavailable right now.", "PAYMENT_DOWN", 503, true);
      },
    });
    const outcome = await runAgentTool(ctxFor(), { toolName: "flaky", args: {} });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.code).toBe("PAYMENT_DOWN");
    expect(outcome.retryable).toBe(true);
    expect(audit.at(-1)!.result).toBe("error");
  });

  it("does not leak internal error details to the caller for unknown failures", async () => {
    registerTool({
      name: "boom",
      description: "test",
      inputSchema: noArgs,
      permission: "user",
      confirmationRequired: false,
      category: "support",
      handler: async () => {
        throw new Error("connection string postgres://user:hunter2@host/db failed");
      },
    });
    const outcome = await runAgentTool(ctxFor(), { toolName: "boom", args: {} });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect((outcome as any).message).not.toContain("hunter2");
    // The full detail still reaches the audit log for operators.
    expect(audit.at(-1)!.errorMessage).toContain("hunter2");
  });
});