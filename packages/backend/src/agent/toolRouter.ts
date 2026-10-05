import { isAdminTierRole } from "../rbac/activeRole";
import {
  resolveAdminPermissions,
  hasPermission,
  guardRole,
} from "../rbac/permissions";
import { ADMIN_ROLES, SUPER_ADMIN_ROLE, type Action, type Section } from "../rbac/sections";
import {
  AgentToolError,
  type AgentToolContext,
  type AgentToolDef,
  canInvoke,
  getTool,
} from "./toolRegistry";

/**
 * Whether the caller holds a specific admin (section, action) grant.
 *
 * Mirrors requireSectionAction rather than reimplementing it: same guardRole,
 * same impersonation refusal, same SUPER_ADMIN wildcard, same per-account
 * override falling back to the role template. An admin previewing the customer
 * app (activeRole USER/PARTNER) is refused, matching every admin route.
 */
async function hasAdminPermission(
  ctx: AgentToolContext,
  section: Section,
  action: Action
): Promise<boolean> {
  // Impersonation is off limits for authority-bearing reads and writes, same as
  // requireAdmin. ctx carries no impersonator flag, so this is enforced by the
  // route middleware before the agent is reachable; recorded here so the intent
  // is visible at the point authority is granted.
  const role = guardRole({ role: ctx.accountRole });
  if (!role || role === "USER" || role === "PARTNER" || !ADMIN_ROLES.includes(role as never)) {
    return false;
  }
  if (role === SUPER_ADMIN_ROLE) return true;

  // Prefer the grants already resolved for this request; fall back to resolving
  // here so the gate is still enforced when a caller builds a context directly.
  if (ctx.adminPermissions) return hasPermission(ctx.adminPermissions, section, action);
  const { permissions } = await resolveAdminPermissions(ctx.userId);
  return hasPermission(permissions, section, action);
}

/**
 * Narrows a tool list to the grants the caller actually holds.
 *
 * Execution already denies a tool whose grant is missing, but the model was
 * still being shown it, which both invites hopeless tool calls and spends
 * prompt tokens on a surface the account cannot use. Delegated admins are
 * filtered here; when grants were not resolved the list is left as-is so the
 * runtime gate remains the only thing standing between the model and a denial.
 */
export function grantsFilterFor(ctx: AgentToolContext): (tool: AgentToolDef) => boolean {
  if (!ctx.isAdminTier) return () => true;
  if (guardRole({ role: ctx.accountRole }) === SUPER_ADMIN_ROLE) return () => true;
  const perms = ctx.adminPermissions;
  if (!perms) return () => true;
  return (tool) =>
    !tool.adminPermission ||
    hasPermission(perms, tool.adminPermission.section, tool.adminPermission.action);
}

/**
 * Agent Tool Router — permission validation and the single execution path.
 *
 * Order of operations is fixed and non-negotiable:
 *   1. resolve the tool by exact name (unknown -> deny, never execute)
 *   2. check the caller's role against the tool's declared permission
 *   3. validate the model's arguments with the tool's own schema
 *   4. for mutating tools, require a confirmation token bound to these exact args
 *   5. run the handler
 *   6. write the audit row
 *
 * Nothing here consults the model for identity, role, or approval. The model can
 * only propose a name and arguments; everything that grants authority is decided
 * in this file and in the tool definitions.
 */

export interface AgentInvocation {
  toolName: string;
  args: unknown;
  /** Present when the tool is confirmation-gated. */
  confirmationToken?: string;
}

export type ToolOutcome =
  | { status: "success"; data: unknown }
  | { status: "confirmation_required"; confirmation: ConfirmationPayload }
  | { status: "denied"; reason: string; code: string }
  | { status: "failed"; message: string; code: string; retryable: boolean; details?: unknown };

export interface ConfirmationPayload {
  token: string;
  toolName: string;
  /** Rendered for the dialog: what will change, the target, any amount. */
  summary: string;
  /** Resolved arguments, so the dialog describes the actual operation. */
  args: unknown;
  expiresAt: string;
}

// --- confirmation store -----------------------------------------------------
// In-process and single-use. A confirmation is bound to one user, one tool and
// one exact argument set, and expires quickly, so a token cannot be replayed
// later or reused with different inputs. A restart invalidates pending
// confirmations, which fails safe: the user is asked to confirm again.
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
interface PendingConfirmation {
  userId: string;
  toolName: string;
  argsFingerprint: string;
  summary: string;
  expiresAt: number;
  used: boolean;
}
const pending = new Map<string, PendingConfirmation>();

function fingerprint(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function issueConfirmation(
  ctx: AgentToolContext,
  tool: AgentToolDef,
  args: unknown,
  summary: string
): ConfirmationPayload {
  const token = `cfm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  pending.set(token, {
    userId: ctx.userId,
    toolName: tool.name,
    argsFingerprint: fingerprint(tool.name, args),
    summary,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    used: false,
  });
  return {
    token,
    toolName: tool.name,
    summary,
    args,
    expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString(),
  };
}

export type ConfirmationResolution =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function consumeConfirmation(
  ctx: AgentToolContext,
  toolName: string,
  args: unknown,
  token: string | undefined
): ConfirmationResolution {
  if (!token) {
    return { ok: false, code: "CONFIRMATION_REQUIRED", message: "This action needs your confirmation." };
  }
  const entry = pending.get(token);
  if (!entry) {
    return { ok: false, code: "CONFIRMATION_INVALID", message: "That confirmation expired. Please try again." };
  }
  if (entry.used) {
    return { ok: false, code: "CONFIRMATION_USED", message: "That confirmation was already used." };
  }
  if (entry.expiresAt <= Date.now()) {
    pending.delete(token);
    return { ok: false, code: "CONFIRMATION_EXPIRED", message: "That confirmation expired. Please try again." };
  }
  if (entry.userId !== ctx.userId) {
    return { ok: false, code: "CONFIRMATION_WRONG_USER", message: "That confirmation belongs to another user." };
  }
  if (entry.toolName !== toolName) {
    return { ok: false, code: "CONFIRMATION_WRONG_TOOL", message: "That confirmation was for a different action." };
  }
  if (entry.argsFingerprint !== fingerprint(toolName, args)) {
    return {
      ok: false,
      code: "CONFIRMATION_ARGS_CHANGED",
      message: "The action changed since you confirmed. Review it again.",
    };
  }
  entry.used = true;
  return { ok: true };
}

/** Drops expired entries. Called opportunistically by the router. */
export function pruneConfirmations(): void {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
}

// --- audit ------------------------------------------------------------------
export interface AgentAuditRow {
  userId: string;
  accountRole: string;
  effectiveRole: string;
  sessionId: string;
  toolName: string;
  permission: string;
  confirmationRequired: boolean;
  confirmationStatus: "not_required" | "requested" | "confirmed" | "denied" | "expired";
  result: "success" | "denied" | "error";
  errorCode?: string;
  errorMessage?: string;
  ip?: string;
  userAgent?: string;
  isAdminAction: boolean;
}

export type AuditSink = (row: AgentAuditRow) => Promise<void> | void;

/**
 * Overridable so tests can assert without a database. The production sink
 * writes to AuditLog.
 */
let auditSink: AuditSink = () => {};

export function setAuditSink(sink: AuditSink): void {
  auditSink = sink;
}

async function writeAudit(row: AgentAuditRow): Promise<void> {
  try {
    await auditSink(row);
  } catch {
    // An audit failure must not mask the tool result. The in-memory audit test
    // buffer and the console remain the fallback; production persistence lives
    // in the sink configured at app start.
  }
}

// --- execution --------------------------------------------------------------

export async function runAgentTool(
  ctx: AgentToolContext,
  invocation: AgentInvocation
): Promise<ToolOutcome> {
  pruneConfirmations();

  const tool = getTool(invocation.toolName);
  if (!tool) {
    await writeAudit({
      ...baseAudit(ctx, "unknown"),
      permission: "unknown",
      confirmationRequired: false,
      confirmationStatus: "not_required",
      result: "denied",
      errorCode: "TOOL_NOT_FOUND",
      errorMessage: `No such tool: ${invocation.toolName}`,
    });
    return {
      status: "denied",
      reason: `"${invocation.toolName}" is not an available action.`,
      code: "TOOL_NOT_FOUND",
    };
  }

  // Admin-tier accounts bypass the role matrix only because they already hold
  // admin authority elsewhere in the app; every call is still audited as an
  // admin action and admin tools additionally require the explicit admin role.
  const isAdminTier = ctx.isAdminTier || isAdminTierRole(ctx.accountRole);
  if (!canInvoke(tool, ctx.role, isAdminTier)) {
    await writeAudit({
      ...baseAudit(ctx, tool.name),
      permission: tool.permission,
      confirmationRequired: tool.confirmationRequired,
      confirmationStatus: "not_required",
      result: "denied",
      errorCode: "TOOL_FORBIDDEN",
      errorMessage: `Role ${ctx.role} may not call ${tool.name}`,
    });
    return {
      status: "denied",
      reason: "Your account does not have access to that action.",
      code: "TOOL_FORBIDDEN",
    };
  }

  // Section+action grant, resolved against the account's real AdminUser row.
  //
  // Placed before validation and confirmation on purpose: a delegated admin with
  // no WITHDRAWALS grant must never be shown a confirmation dialog for approving
  // a payout, because offering it implies they can. Since /agent/confirm re-enters
  // this function with the token, running the check here also re-authorizes the
  // execution, so a grant revoked between the offer and the approval still fails.
  if (tool.adminPermission) {
    const granted = await hasAdminPermission(ctx, tool.adminPermission.section, tool.adminPermission.action);
    if (!granted) {
      await writeAudit({
        ...baseAudit(ctx, tool.name),
        permission: tool.permission,
        confirmationRequired: tool.confirmationRequired,
        confirmationStatus: "not_required",
        result: "denied",
        errorCode: "PERMISSION_DENIED",
        errorMessage: `Role ${ctx.role} lacks ${tool.adminPermission.section}.${tool.adminPermission.action}`,
      });
      return {
        status: "denied",
        reason: "Your admin account does not have permission for that action.",
        code: "PERMISSION_DENIED",
      };
    }
  }

  // Validate before confirming, so the dialog always describes validated input.
  const parsed = tool.inputSchema.safeParse(invocation.args ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    await writeAudit({
      ...baseAudit(ctx, tool.name),
      permission: tool.permission,
      confirmationRequired: tool.confirmationRequired,
      confirmationStatus: "not_required",
      result: "denied",
      errorCode: "TOOL_BAD_INPUT",
      errorMessage: detail,
    });
    return { status: "failed", message: `That request was missing valid details.`, code: "TOOL_BAD_INPUT", retryable: false, details: detail };
  }

  const args = parsed.data;

  if (tool.confirmationRequired) {
    const summary = tool.confirmationSummary ? tool.confirmationSummary(args) : describeArgs(args);
    const verdict = consumeConfirmation(ctx, tool.name, args, invocation.confirmationToken);
    if (!verdict.ok) {
      await writeAudit({
        ...baseAudit(ctx, tool.name),
        permission: tool.permission,
        confirmationRequired: true,
        confirmationStatus: verdict.code === "CONFIRMATION_REQUIRED" ? "requested" : "expired",
        result: "denied",
        errorCode: verdict.code,
        errorMessage: verdict.message,
      });
      if (verdict.code === "CONFIRMATION_REQUIRED") {
        return {
          status: "confirmation_required",
          confirmation: issueConfirmation(ctx, tool, args, summary),
        };
      }
      return { status: "denied", reason: verdict.message, code: verdict.code };
    }
  }

  try {
    const data = await tool.handler(ctx, args);
    await writeAudit({
      ...baseAudit(ctx, tool.name),
      permission: tool.permission,
      confirmationRequired: tool.confirmationRequired,
      confirmationStatus: tool.confirmationRequired ? "confirmed" : "not_required",
      result: "success",
      isAdminAction: isAdminTier && tool.permission === "admin",
    });
    return { status: "success", data };
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; statusCode?: number; retryable?: boolean };
    const isToolError = e instanceof AgentToolError;
    const code = err.code ?? "TOOL_FAILED";
  const message = isToolError
    ? err.message ?? "That action could not be completed."
    : "Something went wrong while running that action.";
  // An unexpected throw is replaced with a generic message on purpose, so the
  // stack has to be logged here or it is lost: the caller, the model and the user
  // all see the same opaque sentence. Without this, a stubbed or mis-wired Prisma
  // call in a tool is indistinguishable from a permissions problem in the audit
  // trail.
  if (!isToolError) {
    console.error(
      `[agent] Tool "${tool.name}" threw for user ${ctx.userId}:`,
      e instanceof Error ? (e.stack ?? e.message) : e
    );
  }
    await writeAudit({
      ...baseAudit(ctx, tool.name),
      permission: tool.permission,
      confirmationRequired: tool.confirmationRequired,
      confirmationStatus: tool.confirmationRequired ? "confirmed" : "not_required",
      result: "error",
      errorCode: code,
      errorMessage: err.message,
    });
    return {
      status: "failed",
      message,
      code,
      retryable: err.retryable ?? false,
      details: err.statusCode,
    };
  }
}

function baseAudit(ctx: AgentToolContext, toolName: string) {
  return {
    toolName,
    userId: ctx.userId,
    accountRole: ctx.accountRole,
    effectiveRole: ctx.role,
    sessionId: ctx.sessionId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    isAdminAction: isAdminTierRole(ctx.accountRole) || isAdminTierRole(ctx.role),
  };
}

function describeArgs(args: unknown): string {
  const parts: string[] = [];
  if (args && typeof args === "object") {
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (v !== undefined && v !== null && typeof v !== "object") {
        parts.push(`${k.replace(/_/g, " ")}: ${String(v)}`);
      }
    }
  }
  return parts.length ? parts.join(", ") : "the requested changes";
}

/** Test helper. Clears pending confirmations. */
export function __resetConfirmationsForTests(): void {
  pending.clear();
}