import { Response } from "express";
import { prisma } from "../config/database";
import { isAdminTierRole } from "../rbac/activeRole";
import { getClientIp } from "../rbac/adminSecurity";
import { sendError, sendSuccess } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { runAgentTurn, type AgentTurnResult } from "../agent/agentService";
import { consumeConfirmation, grantsFilterFor, runAgentTool } from "../agent/toolRouter";
import { listToolsForGrants, type AgentToolContext } from "../agent/toolRegistry";
import { resolveAdminPermissions } from "../rbac/permissions";

// Importing the tool modules is what registers them.
import "../agent/tools/userTools";
import "../agent/tools/writeTools";
import "../agent/tools/partnerTools";
import "../agent/tools/adminTools";

/**
 * Agent HTTP surface.
 *
 * Thin by design: authenticate, build the context from the session, call the
 * agent service. All policy lives in the registry/router, so a new tool never
 * requires a new endpoint here.
 */

const MAX_MESSAGE_LENGTH = 1000;

function buildContext(req: AuthedRequest, sessionId: string): AgentToolContext | null {
  const user = req.user;
  if (!user?.userId) return null;
  const role = (user.activeRole || user.role || "USER") as string;
  const accountRole = (user.role || "USER") as string;
  return {
    userId: user.userId,
    role,
    accountRole,
    isAdminTier: isAdminTierRole(role) || isAdminTierRole(accountRole),
    sessionId,
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"],
  };
}

/**
 * Resolves the caller's delegated-admin grants once and attaches them to the
 * context, so the tools the model is offered and the gate that executes them
 * come from a single resolution. A failure here must not grant authority, so
 * it resolves to an empty grant list: the agent stays usable for everything the
 * caller legitimately holds as a customer.
 */
async function withAdminGrants(ctx: AgentToolContext): Promise<AgentToolContext> {
  if (!ctx.isAdminTier) return ctx;
  try {
    const { permissions } = await resolveAdminPermissions(ctx.userId);
    return { ...ctx, adminPermissions: permissions };
  } catch (e) {
    console.warn(`[agent] could not resolve admin grants: ${e instanceof Error ? e.message : String(e)}`);
    return { ...ctx, adminPermissions: [] };
  }
}

/** Stable per-conversation id, derived from the user's existing chat session. */
async function resolveSessionId(req: AuthedRequest): Promise<string> {
  const requested = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  if (requested && /^[A-Za-z0-9_-]{8,64}$/.test(requested)) return requested;
  return `agent_${req.user!.userId}`;
}

export async function agentAsk(req: AuthedRequest, res: Response): Promise<void> {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    sendError(res, "A message is required.", 400, "VALIDATION_ERROR");
    return;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    sendError(res, "That message is too long.", 400, "MESSAGE_TOO_LONG");
    return;
  }

  const sessionId = await resolveSessionId(req);
  const built = buildContext(req, sessionId);
  if (!built) {
    sendError(res, "Sign in to use the assistant.", 401, "UNAUTHENTICATED");
    return;
  }
  const ctx = await withAdminGrants(built);

  // Location is only forwarded when the client explicitly granted it for this
  // turn. Absent otherwise, and never persisted.
  let location: AgentToolContext["location"];
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);
  const granted = req.body?.locationGranted === true;
  if (granted && Number.isFinite(lat) && Number.isFinite(lng)) {
    location = { latitude: lat, longitude: lng };
  }

  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .filter(
          (h: unknown): h is { role: "user" | "assistant"; content: string } =>
            !!h &&
            typeof (h as any).role === "string" &&
            typeof (h as any).content === "string" &&
            ((h as any).role === "user" || (h as any).role === "assistant")
        )
        .slice(-8)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }))
    : [];

  const approved =
    req.body?.approvedToken && req.body?.approvedTool
      ? {
          token: String(req.body.approvedToken),
          toolName: String(req.body.approvedTool),
          args: req.body.approvedArgs ?? {},
        }
      : undefined;

  try {
    const result: AgentTurnResult = await runAgentTurn({
      ctx: { ...ctx, location },
      message,
      history,
      approved,
    });
    sendSuccess(res, { ...result, sessionId });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    sendError(res, "The assistant is unavailable right now.", 503, err.code ?? "AGENT_UNAVAILABLE");
  }
}

/**
 * Runs a single confirmed action without involving the model. Used by the
 * "Confirm" button so an approval executes exactly the reviewed operation,
 * with the model's role confined to explaining the outcome afterwards.
 */
export async function agentConfirm(req: AuthedRequest, res: Response): Promise<void> {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const toolName = typeof req.body?.toolName === "string" ? req.body.toolName : "";
  if (!token || !toolName) {
    sendError(res, "token and toolName are required.", 400, "VALIDATION_ERROR");
    return;
  }

  const sessionId = await resolveSessionId(req);
  const built = buildContext(req, sessionId);
  if (!built) {
    sendError(res, "Sign in to use the assistant.", 401, "UNAUTHENTICATED");
    return;
  }
  // The confirmed action runs against the same resolved grants the offer was
  // made under, so a grant revoked mid-flow cannot be spent on a stale token.
  const ctx = await withAdminGrants(built);

  const outcome = await runAgentTool(ctx, {
    toolName,
    args: req.body?.args ?? {},
    confirmationToken: token,
  });
  sendSuccess(res, { outcome, sessionId });
}

/** Tools available to the caller, for the UI's "what can you do" view. */
export async function agentCapabilities(req: AuthedRequest, res: Response): Promise<void> {
  const built = buildContext(req, await resolveSessionId(req));
  if (!built) {
    sendError(res, "Sign in to use the assistant.", 401, "UNAUTHENTICATED");
    return;
  }
  const ctx = await withAdminGrants(built);
  const tools = listToolsForGrants(ctx.role, ctx.isAdminTier, grantsFilterFor(ctx)).map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    confirmationRequired: t.confirmationRequired,
  }));
  sendSuccess(res, { tools });
}

/** Clears the stored conversation for this user. */
export async function agentClearHistory(req: AuthedRequest, res: Response): Promise<void> {
  if (!req.user?.userId) {
    sendError(res, "Sign in to use the assistant.", 401, "UNAUTHENTICATED");
    return;
  }
  // Conversations live in the client until a store is added; the server-side
  // step here is the audit record, so a clear action is always attributable.
  await prisma.auditLog
    .create({
      data: {
        actorId: req.user.userId,
        actorType: "USER",
        action: "AGENT_HISTORY_CLEARED",
        entityType: "AgentConversation",
        metadata: JSON.stringify({ ip: getClientIp(req) }),
        ipAddress: getClientIp(req),
      },
    })
    .catch(() => {});
  sendSuccess(res, { cleared: true });
}

export { consumeConfirmation };