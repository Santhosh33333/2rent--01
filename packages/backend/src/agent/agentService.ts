import { z } from "zod";
import { aiChat, aiProvider, type AiChatMessage } from "../services/aiGateway";
import { getConfig } from "../services/pricingEngine";
import { getDatingRequestCharge } from "../services/datingService";
import { AgentToolError, toolSchemasForRole, type AgentToolContext } from "./toolRegistry";
import { runAgentTool, grantsFilterFor, type ToolOutcome } from "./toolRouter";

/**
 * Agent Service — the model loop.
 *
 * The model is only ever allowed to propose a tool name and JSON arguments. It
 * cannot see a database handle, a token, a service credential, or a user id. It
 * is given the tool schemas its role is permitted to use and nothing else, so
 * admin tools are not even present in the prompt for a normal account.
 *
 * Flow: user message -> model -> (tool call | final answer). Tool calls are
 * executed by the router, which enforces permission, validation, confirmation
 * and audit, and the results are fed back for the model to explain.
 */

const MAX_TOOL_ROUNDS = 6;

/**
 * The provider meters input tokens per minute and the agent re-sends its
 * system prompt plus every tool schema on each round, so a burst of turns can
 * trip a 429 even when the user did nothing wrong. Waiting out a short rate
 * limit is far better than showing the user a broken assistant, so the wait is
 * absorbed here and only a persistent limit is reported.
 */
const RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 8000;

function rateLimitWaitMs(err: { retryAfterSec?: number }): number {
  const seconds = Number(err.retryAfterSec);
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
  return Math.min(ms, MAX_RATE_LIMIT_WAIT_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const SYSTEM_PROMPT = `You are the Nabri in-app assistant. You help users with their Nabri account and the platform.

Rules you must follow:
- Use the provided tools to read real data. Never state a fact about a user's account, payments, requests, partners, events or communities that you did not receive from a tool.
- Never invent ids, prices, statuses, names, counts or availability. If a tool returns nothing, say so plainly.
- Report payment and wallet statuses exactly as the backend returned them. You never decide that a payment succeeded; only the backend and the payment provider can.
- If a tool requires confirmation, still perform it by calling that tool. The system shows the user a confirmation dialog each time; you must not approve, announce, or claim the action in plain text instead of invoking the tool.
- Do not narrate that you are "about to" do something without calling the tool that does it.
- If a tool fails, explain what happened and offer to retry or contact support. Never pretend a failure was a success.
- Keep replies short and plain. No markdown headings or tables. Use at most a short list when listing items.
- You can only use the tools provided. If a request needs something you cannot do, say so.`;

/**
 * The facts the model must not guess, read live from PricingConfig.
 *
 * The system prompt already forbids inventing prices, and the model invents them
 * anyway. Measured against the configured provider: asked "I sent a dating
 * request and 40 rupees left my wallet, was I charged a fee?", qwen/qwen3.8-27b
 * correctly said the wallet balance is separate from the request, while
 * openai/gpt-oss-120b asserted "your dating request cost 40 rupees" and
 * gpt-oss-20b called it "a small transaction fee". No prompt wording fixes
 * that - a rule against inventing a number is weaker than having the number.
 *
 * So the ground truth goes in the prompt, read through the same cached
 * getConfig the checkout uses, which means it stays correct when an admin
 * changes a price and costs one already-cached lookup per turn.
 */
async function platformFacts(): Promise<string> {
  // getConfig takes a number default, and its own catch also returns that
  // default - so a sentinel is the only way to tell "not configured" from
  // "configured as zero". -1 is not a price anything can legitimately be set to.
  const UNSET = -1;
  try {
    const [charge, baseFee] = await Promise.all([
      getDatingRequestCharge(),
      getConfig("BASE_FEE", UNSET),
    ]);
    const lines = [
      "- Sending one dating request costs " + (charge > 0 ? `₹${charge.toFixed(2)}` : "nothing (charging is currently switched off)") +
        ", taken from the sender's wallet at the moment the request is sent. There is no other fee for sending a request.",
    ];
    if (baseFee !== UNSET && Number.isFinite(baseFee)) {
      lines.push(`- The platform booking fee is ₹${Number(baseFee).toFixed(2)}.`);
    }
    lines.push(
      "- If a user's account balance does not move by exactly these amounts, say what did change and stop - do not explain the difference with a price you were not given.",
    );
    return lines.join("\n");
  } catch {
    // Never let a config read failure stop someone getting an answer. Without
    // the facts the model falls back to its own knowledge, which is worse, but
    // that is not a reason to refuse to reply.
    console.warn("[agent] could not load pricing facts for the system prompt");
    return "- Pricing is unavailable right now. Never state a price; say you cannot confirm the amount and offer to check.";
  }
}

export interface AgentTurnResult {
  /** Text for the user, already grounded in tool output. */
  message: string;
  /** Tools the model asked for, with their verified outcome. Surfaced in the UI. */
  toolActivity: AgentToolActivity[];
  /** True when a tool is waiting on the user's confirmation. */
  awaitingConfirmation: AgentConfirmationRequest[];
  /** Follow-up prompts derived from real results, never fabricated. */
  suggestions: string[];
  /** Set when the turn could not complete; the UI offers retry/support. */
  error?: { code: string; message: string; retryable: boolean };
}

export interface AgentToolActivity {
  toolName: string;
  status: "success" | "denied" | "failed" | "confirmation_required";
  /** Human-readable result summary. Contains no secrets. */
  summary: string;
  data?: unknown;
}

export interface AgentConfirmationRequest {
  token: string;
  toolName: string;
  summary: string;
  args: unknown;
  expiresAt: string;
}

export interface AgentTurnInput {
  ctx: AgentToolContext;
  message: string;
  /** Earlier turns, oldest first. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Confirmation token the user just approved, if any. */
  approved?: { token: string; toolName: string; args: unknown };
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const { ctx } = input;
  const activity: AgentToolActivity[] = [];
  const confirmations: AgentConfirmationRequest[] = [];

  if (aiProvider() === "none") {
    return {
      message:
        "The AI assistant isn't configured on this server yet, so I can't answer right now.",
      toolActivity: [],
      awaitingConfirmation: [],
      suggestions: [],
      error: { code: "AI_NOT_CONFIGURED", message: "AI provider not configured.", retryable: false },
    };
  }

  const tools = toolSchemasForRole(ctx.role, ctx.isAdminTier, grantsFilterFor(ctx));
  if (!tools.length) {
    return {
      message: "No assistant actions are available for your account.",
      toolActivity: [],
      awaitingConfirmation: [],
      suggestions: [],
      error: { code: "NO_TOOLS", message: "No tools available for role.", retryable: false },
    };
  }

  const facts = await platformFacts();
  const messages: AiChatMessage[] = [{ role: "system", content: `${SYSTEM_PROMPT}\n\nCurrent platform pricing (true, from the database - never contradict or adjust these):\n${facts}` }];
  for (const h of input.history ?? []) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: input.message });

  // A user-approved confirmation runs first so the model can explain the result
  // without having to re-issue the same call.
  let approvedExecuted = false;
  if (input.approved) {
    const outcome = await runAgentTool(ctx, {
      toolName: input.approved.toolName,
      args: input.approved.args,
      confirmationToken: input.approved.token,
    });
    const act = toActivity(outcome, input.approved.toolName);
    activity.push(act);
    if (outcome.status === "confirmation_required") {
      confirmations.push(outcome.confirmation);
      return {
        message: "That action still needs your confirmation.",
        toolActivity: activity,
        awaitingConfirmation: confirmations,
        suggestions: [],
      };
    }

    approvedExecuted = true;
    // State the outcome as settled fact. Without this the model still holds the
    // original "yes, do it" message with no record that the write already
    // happened, so it re-plans the action, asks for details it was already
    // given, and tells the user it is waiting when it is not. The verified
    // payload is included so the reply quotes real values instead of restating
    // the request.
    messages.push({
      role: "user",
      content: [
        `EXECUTION NOTICE: you already ran "${input.approved.toolName}" on the server after the user approved it.`,
        "It has been applied. Do not call it again, do not ask for its parameters, and do not describe it as pending.",
        `Verified outcome: ${safeJson(act.data ?? act.summary)}`,
        "Now report this result to the user in plain language.",
      ].join(" "),
    });
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let completion;
    for (let attempt = 0; ; attempt++) {
      try {
        // After an approved action has already run, the tools are withheld for the
        // reporting call. The model has nothing left to do but describe the
        // outcome, and this makes repeating the write impossible rather than
        // merely discouraged.
        completion = approvedExecuted
          ? await aiChat(ctx.userId, messages, { maxTokens: 400 })
          : await aiChat(ctx.userId, messages, { tools, toolChoice: "auto", maxTokens: 700 });
        break;
      } catch (e: unknown) {
        const err = e as {
          code?: string;
          message?: string;
          retryAfterSec?: number;
          status?: number;
        };
        const code = err.code ?? "AI_UNAVAILABLE";
        // The caller only ever sees the generic sentence below. Log the real
        // cause here, otherwise a provider outage or quota stop is undiagnosable.
        console.warn(`[agent] completion failed (${code}): ${err.message ?? "unknown"}`);
        if (code === "AI_RATE_LIMITED" && attempt < RATE_LIMIT_RETRIES) {
          await sleep(rateLimitWaitMs(err));
          continue;
        }
        return {
          message:
            code === "AI_QUOTA_EXCEEDED"
              ? "You've reached the assistant's hourly limit. Try again a little later."
              : code === "AI_RATE_LIMITED"
                ? "The assistant is busy right now. Try again in a moment."
                : "I couldn't reach the assistant service just now.",
          toolActivity: activity,
          awaitingConfirmation: [],
          suggestions: [],
          error: {
            code,
            message: err.message ?? "AI unavailable",
            retryable:
              code === "AI_QUOTA_EXCEEDED" ||
              code === "AI_UNAVAILABLE" ||
              code === "AI_RATE_LIMITED",
          },
        };
      }
    }

    const calls = completion.message.tool_calls ?? [];
    if (!calls.length) {
      const text = (completion.message.content ?? "").trim();
      return {
        message: text || "I'm not sure what you're asking for. Could you rephrase?",
        toolActivity: activity,
        awaitingConfirmation: [],
        suggestions: suggestFor(activity),
      };
    }

    messages.push({
      role: "assistant",
      content: completion.message.content,
      tool_calls: calls,
    });

    // Stop and surface the dialog the moment any tool needs confirmation, so
    // nothing else runs while the user decides.
    let blocked = false;
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "INVALID_ARGUMENTS: the arguments were not valid JSON.",
        });
        activity.push({
          toolName: call.function.name,
          status: "failed",
          summary: "I couldn't read the details for that action.",
        });
        continue;
      }

const outcome = await runAgentTool(ctx, { toolName: call.function.name, args });
      const act = toActivity(outcome, call.function.name);
      activity.push(act);

      if (outcome.status === "confirmation_required") {
        confirmations.push(outcome.confirmation);
        blocked = true;
        continue;
      }
      if (outcome.status === "denied") {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `DENIED (${outcome.code}): ${outcome.reason}`,
        });
        continue;
      }
      if (outcome.status === "failed") {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `FAILED (${outcome.code}): ${outcome.message} retryable=${outcome.retryable}`,
        });
        continue;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.data ?? null),
      });
    }

    if (blocked) {
      return {
        message: confirmations.length
          ? "Before I do that, please confirm the details below."
          : "I need your confirmation first.",
        toolActivity: activity,
        awaitingConfirmation: confirmations,
        suggestions: [],
      };
    }
  }

  return {
    message: "That needed more steps than I can safely take right now. Try asking for one thing at a time.",
    toolActivity: activity,
    awaitingConfirmation: [],
    suggestions: [],
    error: { code: "TOOL_LOOP_EXHAUSTED", message: "Too many tool rounds.", retryable: true },
  };
}

/**
 * The tool name is passed in rather than inferred: only the caller knows whether
 * the round was a model-proposed tool or a user-approved one, and every status
 * branch needs the real name so the UI and the audit trail can identify the
 * operation. A literal "tool" here would make every completed action
 * indistinguishable in the activity list.
 */
/**
 * Serialises a tool result for the model without risking a crash on a circular
 * structure or leaking an unexpected value. Falls back to a short string so a
 * reporting problem never turns into a failed turn.
 */
function safeJson(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 800);
  try {
    return JSON.stringify(value ?? null).slice(0, 800);
  } catch {
    return String(value).slice(0, 800);
  }
}

function toActivity(outcome: ToolOutcome, toolName: string): AgentToolActivity {
  if (outcome.status === "success") {
    return { toolName, status: "success", summary: summarise(outcome.data), data: outcome.data };
  }
  if (outcome.status === "confirmation_required") {
    return {
      toolName: outcome.confirmation.toolName,
      status: "confirmation_required",
      summary: outcome.confirmation.summary,
      data: outcome.confirmation.args,
    };
  }
  if (outcome.status === "denied") {
    return { toolName, status: "denied", summary: outcome.reason };
  }
  return { toolName, status: "failed", summary: outcome.message };
}

/** Compact, human summary of a tool payload for the activity list. */
function summarise(data: unknown): string {
  if (!data || typeof data !== "object") return "Done.";
  const d = data as Record<string, unknown>;

  // Write outcomes first: these are the ones a user is staring at in the
  // activity list right after approving something, so "Retrieved from the
  // database" would be actively misleading about what just happened.
  if (typeof d.status === "string") {
    if (d.alreadyCancelled === true) return "Already cancelled, nothing changed.";
    const ref =
      (typeof d.requestId === "string" && d.requestId) ||
      (typeof d.eventId === "string" && d.eventId) ||
      (typeof d.reportId === "string" && d.reportId) ||
      "";
    const where = typeof d.route === "string" ? ` (${d.route})` : "";
    return `${d.status}${where}${ref ? ` \u00b7 ${ref.slice(0, 8)}` : ""}`;
  }
  if (d.registered === true) return "Registered for the event.";
  if (typeof d.count === "number") return `${d.count} result(s)`;
  if (typeof d.totalFound === "number") {
    return d.totalFound === 1 ? "1 partner found" : `${d.totalFound} partners found`;
  }
  if (d.hasActiveRequest === false) return "No active request.";
  if (d.hasSubscription === false) return "No subscription on this account.";
  return "Done.";
}

/** Follow-ups grounded in what actually ran. */
function suggestFor(activity: AgentToolActivity[]): string[] {
  const names = new Set(activity.map((a) => a.toolName));
  if (names.size === 0) {
    return ["Show my active request", "What's my subscription status?", "Find events this weekend"];
  }
  const out: string[] = [];
  if (activity.some((a) => a.summary.includes("0 result") || a.summary.includes("No "))) {
    out.push("Show my notifications");
  }
  out.push("Show my active request", "What is my wallet balance?");
  return out.slice(0, 3);
}

export { AgentToolError };