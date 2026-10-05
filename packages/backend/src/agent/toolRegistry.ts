import { z } from "zod";
import type { Action, Section } from "../rbac/sections";

/**
 * Agent Tool Registry — types and the registry core.
 *
 * The model never receives a Prisma client, a database URL, or an HTTP client.
 * It can only emit a tool name plus a JSON argument object. Every name is looked
 * up here, the arguments are validated with that tool's own schema, the caller's
 * role is checked against the tool's declared permission, and a handler performs
 * the work with the authenticated user id threaded through. An unknown name is
 * denied rather than passed to the model, so a hallucinated tool call cannot
 * reach anything.
 *
 * Adding a capability means adding one entry to a registry array. No router,
 * controller, or UI change is required.
 */

/** Who may invoke a tool. Checked against the caller's effective role. */
export type AgentPermission = "user" | "partner" | "admin";

/**
 * Whether the caller must also hold a specific account type.
 *
 * A delegated admin may switch `activeRole` to USER or PARTNER to preview the app.
 * `roles` therefore matches the *effective* role, not the underlying account role,
 * so previewing as PARTNER does not silently unlock admin-only tools.
 */
export interface AgentToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable identifier used by the model and the audit log. */
  name: string;
  /** Shown to the model. Must state what the tool returns and any limits. */
  description: string;
  /** Argument validation. The model cannot influence this. */
  inputSchema: S;
  /** Minimum permission required. */
  permission: AgentPermission;
  /** Roles permitted to call it. Narrower than `permission` when needed. */
  roles?: string[];
  /**
   * The admin (section, action) grant this tool requires.
   *
   * `permission: "admin"` only proves the caller is somewhere in the admin tier,
   * which is not enough: the platform's actual trust chain is
   * SUPER_ADMIN -> ROLE -> SECTION -> PERMISSION -> ACTION, and a delegated
   * SUPPORT account is admin-tier while holding nothing in WITHDRAWALS. A tool
   * that moves money or reads other people's records must name the grant it
   * needs, resolved per call against the account's real AdminUser row.
   *
   * Enforced in the router, which is async; the sync role matrix above cannot
   * answer it.
   */
  adminPermission?: { section: Section; action: Action };
  /**
   * True when the tool changes data or moves money. The agent must obtain an
   * explicit confirmation for the exact resolved arguments before the handler
   * runs. Read-only tools never set this.
   */
  confirmationRequired: boolean;
  /** Grouping for the UI and for keeping a user's tools discoverable. */
  category: "profile" | "requests" | "discovery" | "payments" | "community" | "support" | "partner" | "admin";
  /** Human-readable summary of what a confirmation dialog should show. */
  confirmationSummary?: (args: z.infer<S>) => string;
  handler: (ctx: AgentToolContext, args: z.infer<S>) => Promise<unknown>;
}

export interface AgentToolContext {
  /** Authenticated user id. Never model-supplied. */
  userId: string;
  /** Effective role for this request, after any admin preview. */
  role: string;
  /** Underlying account role, used for audit and admin-tier checks. */
  accountRole: string;
  isAdminTier: boolean;
  /**
   * The caller's resolved delegated-admin grants for this request, attached once
   * by the controller. Present only for admin-tier callers.
   *
   * Carrying them on the context means the tool list the model is shown and the
   * permission gate that executes a tool are decided from one resolution rather
   * than two that could drift. `["*"]` is the super-admin wildcard.
   */
  adminPermissions?: string[];
  /** Conversation id, recorded in the audit log. */
  sessionId: string;
  /** Client IP, recorded in the audit log. */
  ip?: string;
  userAgent?: string;
  /**
   * Location the user has actually authorised for this request. Absent unless
   * permission was granted and the tool declared `usesLocation`.
   */
  location?: { latitude: number; longitude: number; accuracyMeters?: number };
}

export class AgentToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly retryable = false
  ) {
    super(message);
    this.name = "AgentToolError";
  }
}

const registry = new Map<string, AgentToolDef>();

export function registerTool<S extends z.ZodTypeAny>(tool: AgentToolDef<S>): void {
  if (registry.has(tool.name)) {
    throw new Error(`Agent tool "${tool.name}" is already registered.`);
  }
  registry.set(tool.name, tool as unknown as AgentToolDef);
}

export function registerTools(tools: AgentToolDef[]): void {
  for (const t of tools) registerTool(t);
}

export function getTool(name: string): AgentToolDef | undefined {
  return registry.get(name);
}

export function listTools(): AgentToolDef[] {
  return [...registry.values()];
}

/** Tool names the given role is allowed to see. Admin sees everything. */
export function listToolsForRole(role: string, isAdminTier: boolean): AgentToolDef[] {
  return listTools().filter((t) => canInvoke(t, role, isAdminTier));
}

/**
 * Role filtering alone is not enough for a delegated admin. An account in an
 * admin role is offered every admin tool, so a finance officer holding four
 * grants was shown (and billed for, in prompt tokens) the entire admin surface
 * including tools their grants do not cover. Narrowing the list by the account's
 * real grants keeps unauthorized tools out of the model's view entirely.
 *
 * Non-delegated tools are unaffected: this only removes admin tools whose
 * declared grant the account does not hold.
 */
export function listToolsForGrants(
  role: string,
  isAdminTier: boolean,
  grants?: (tool: AgentToolDef) => boolean
): AgentToolDef[] {
  const tools = listToolsForRole(role, isAdminTier);
  if (!grants) return tools;
  return tools.filter((t) => !t.adminPermission || grants(t));
}

const PERMISSION_RANK: Record<AgentPermission, number> = { user: 0, partner: 1, admin: 2 };

export function canInvoke(tool: AgentToolDef, role: string, isAdminTier: boolean): boolean {
  // An explicit roles allowlist is a delegation decision, not a hint, so it is
  // checked before the admin-tier shortcut. Checking it afterwards made it
  // unreachable: `if (isAdminTier) return true` fired first, which meant the
  // moment a real admin tool was added with roles: ["ADMIN"], every admin-tier
  // account including a delegated one with no rights to it would have been let
  // in. Such a tool now has to opt in to admin-tier reach by omitting roles.
  if (tool.roles && !tool.roles.includes(role)) return false;
  if (isAdminTier) return true;
  // The caller must be at least the required tier. PARTNER accounts satisfy
  // "user" tools, admin-tier accounts satisfy everything.
  const callerRank = role === "PARTNER" ? PERMISSION_RANK.partner : PERMISSION_RANK.user;
  return callerRank >= PERMISSION_RANK[tool.permission];
}

/**
 * Tool schemas in the shape the OpenAI-compatible chat-completions API expects.
 * Filtered to the caller's role so the model cannot even see admin tools.
 */
export function toolSchemasForRole(
  role: string,
  isAdminTier: boolean,
  grants?: (tool: AgentToolDef) => boolean
): Array<{
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}> {
  const schemas: Array<{
    type: "function";
    function: { name: string; description: string; parameters: unknown };
  }> = [];

  for (const t of listToolsForGrants(role, isAdminTier, grants)) {
    let parameters: unknown;
    try {
      parameters = zodToJsonSchema(t.inputSchema);
    } catch (err) {
      // One tool with a schema this converter cannot render must not blank the
      // whole agent for every caller: this list is what /capabilities returns and
      // what the model is allowed to see. Hiding the offending tool keeps the
      // assistant usable, and the warning makes the defect loud in logs rather
      // than silent at runtime. The tool's own tests fail on the same schema.
      console.warn(
        `[agent] Omitting tool "${t.name}" from schemas: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    schemas.push({
      type: "function",
      function: { name: t.name, description: t.description, parameters },
    });
  }

  return schemas;
}

/**
 * Minimal zod -> JSON Schema. Deliberately handles only the shapes tools use
 * (object/array/string/number/boolean/enum/optional/default) rather than
 * pulling in a dependency; unknown constructs fail loudly at registration time
 * via the tools' own tests.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;

  if (typeName === "ZodObject") {
    const shape = (def.shape as () => z.ZodTypeAny)();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!isOptional(value)) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
  }

  if (typeName === "ZodOptional") {
    return zodToJsonSchema(def.innerType as z.ZodTypeAny);
  }
  if (typeName === "ZodDefault") {
    return zodToJsonSchema(def.innerType as z.ZodTypeAny);
  }
  if (typeName === "ZodNullable") {
    return zodToJsonSchema(def.innerType as z.ZodTypeAny);
  }

  if (typeName === "ZodArray") {
    return { type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) };
  }

  if (typeName === "ZodEnum") {
    return { type: "string", enum: def.values as string[] };
  }

  if (typeName === "ZodNumber") {
    return { type: "number" };
  }
  if (typeName === "ZodBoolean") {
    return { type: "boolean" };
  }
  if (typeName === "ZodString") {
    const checks = (def.checks as Array<{ kind: string; value?: number }>) ?? [];
    const out: Record<string, unknown> = { type: "string" };
    for (const c of checks) {
      if (c.kind === "min") out.minLength = c.value;
      if (c.kind === "max") out.maxLength = c.value;
    }
    return out;
  }

  // Anything else (records, unions, transforms) is not used by tools today.
  throw new Error(`Unsupported zod type in agent tool schema: ${typeName ?? "unknown"}`);
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName: string } })._def.typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

/** Test helper. Replaces the registry contents. */
export function __resetRegistryForTests(): void {
  registry.clear();
}