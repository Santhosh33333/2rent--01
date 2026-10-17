import { prisma } from "../config/database";

/**
 * Live connection categories.
 *
 * These describe how a user connects to a partner *now* (chat, voice, video)
 * and what each mode costs per minute. They are deliberately separate from
 * `SERVICE_CATALOG`, which drives scheduled bookings — the two catalogues
 * answer different questions and merging them would force booking pricing
 * rules onto live sessions.
 *
 * The table is additive and may legitimately be empty: until an admin seeds or
 * creates rows, every read falls back to `CONNECTION_CATEGORY_DEFAULTS` so the
 * connection flow never depends on a manual setup step. The fallback is
 * read-only — a GET never writes.
 */

export interface ConnectionCategoryShape {
  /**
   * Absent for the built-in defaults: they have no row until an admin seeds
   * them, so nothing can address them by id yet.
   */
  id?: string;
  key: string;
  label: string;
  description: string | null;
  chatEnabled: boolean;
  callEnabled: boolean;
  videoEnabled: boolean;
  isPaid: boolean;
  chatPricePerMinute: number;
  callPricePerMinute: number;
  videoPricePerMinute: number;
  enabled: boolean;
  sortOrder: number;
}

/**
 * The shipped categories. Call rates match the existing call-billing default
 * (₹1/min); chat is free — the product rule is that normal messaging is never
 * charged unless an admin explicitly prices a category.
 */
export const CONNECTION_CATEGORY_DEFAULTS: ConnectionCategoryShape[] = [
  {
    key: "DATING",
    label: "Dating",
    description: "Meet someone one-to-one",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 10,
  },
  {
    key: "MAKE_FRIENDS",
    label: "Make Friends",
    description: "Find new people to talk to",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 20,
  },
  {
    key: "CASUAL_CHAT",
    label: "Casual Chat",
    description: "Light conversation, no agenda",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 30,
  },
  {
    key: "TIME_PASS",
    label: "Time Pass Speak",
    description: "Company while you pass the time",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 40,
  },
  {
    key: "BREAKUP_TALK",
    label: "Breakup Feelings Talk",
    description: "Talk through a breakup",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 50,
  },
  {
    key: "FEELINGS_TALK",
    label: "Talk About My Feelings",
    description: "Say what you have been holding in",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 60,
  },
  {
    key: "MOVIE_BUDDY",
    label: "Movie Buddy",
    description: "Find someone to watch with",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 70,
  },
  {
    key: "ACTIVITY_BUDDY",
    label: "Walking & Activity Buddy",
    description: "Someone for a walk or activity",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 80,
  },
  {
    key: "TRAVEL_BUDDY",
    label: "Travel Buddy",
    description: "Company for a trip",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 90,
  },
  {
    key: "OTHER",
    label: "Other",
    description: "Anything else on your mind",
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 0,
    enabled: true,
    sortOrder: 100,
  },
];

/** Where the list came from — the UI says so instead of implying data exists. */
export type CategorySource = "db" | "defaults";

export interface CategoryListResult {
  items: ConnectionCategoryShape[];
  source: CategorySource;
}

export interface CategoryInput {
  key?: unknown;
  label?: unknown;
  description?: unknown;
  chatEnabled?: unknown;
  callEnabled?: unknown;
  videoEnabled?: unknown;
  chatPricePerMinute?: unknown;
  callPricePerMinute?: unknown;
  videoPricePerMinute?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
}

type CategoryRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  chatEnabled: boolean;
  callEnabled: boolean;
  videoEnabled: boolean;
  isPaid: boolean;
  chatPricePerMinute: unknown;
  callPricePerMinute: unknown;
  videoPricePerMinute: unknown;
  enabled: boolean;
  sortOrder: number;
};

/**
 * Prisma hands back `Decimal` objects; the API contract is plain numbers so the
 * client never has to know which driver type it received.
 */
export function serializeCategory(row: CategoryRow): ConnectionCategoryShape {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    chatEnabled: row.chatEnabled,
    callEnabled: row.callEnabled,
    videoEnabled: row.videoEnabled,
    isPaid: row.isPaid,
    chatPricePerMinute: Number(row.chatPricePerMinute ?? 0),
    callPricePerMinute: Number(row.callPricePerMinute ?? 0),
    videoPricePerMinute: Number(row.videoPricePerMinute ?? 0),
    enabled: row.enabled,
    sortOrder: row.sortOrder,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Only the fields present in `raw` are returned, so a PATCH-style update can
 * never silently reset a field the caller did not mention.
 */
export function normalizeCategoryInput(raw: CategoryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (typeof raw.key === "string") out.key = raw.key.trim().toUpperCase();
  if (typeof raw.label === "string") out.label = raw.label.trim();
  if (raw.description !== undefined) {
    out.description = raw.description === null ? null : String(raw.description).trim() || null;
  }
  if (raw.chatEnabled !== undefined) out.chatEnabled = asBoolean(raw.chatEnabled, true);
  if (raw.callEnabled !== undefined) out.callEnabled = asBoolean(raw.callEnabled, true);
  if (raw.videoEnabled !== undefined) out.videoEnabled = asBoolean(raw.videoEnabled, false);
  if (raw.chatPricePerMinute !== undefined) out.chatPricePerMinute = toPrice(raw.chatPricePerMinute);
  if (raw.callPricePerMinute !== undefined) out.callPricePerMinute = toPrice(raw.callPricePerMinute);
  if (raw.videoPricePerMinute !== undefined) out.videoPricePerMinute = toPrice(raw.videoPricePerMinute);
  if (raw.enabled !== undefined) out.enabled = asBoolean(raw.enabled, true);
  if (raw.sortOrder !== undefined) {
    const n = Number(raw.sortOrder);
    out.sortOrder = Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  return out;
}

function toPrice(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Every category, enabled or not — admin view. Falls back while unseeded. */
export async function listAll(): Promise<CategoryListResult> {
  const rows = await prisma.connectionCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  if (rows.length === 0) return { items: CONNECTION_CATEGORY_DEFAULTS, source: "defaults" };
  return { items: rows.map(serializeCategory), source: "db" };
}

/** Enabled categories only — what the connection flow offers. */
export async function listPublic(): Promise<CategoryListResult> {
  const rows = await prisma.connectionCategory.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  if (rows.length === 0) {
    return {
      items: CONNECTION_CATEGORY_DEFAULTS.filter((c) => c.enabled),
      source: "defaults",
    };
  }
  return { items: rows.map(serializeCategory), source: "db" };
}

/**
 * Materialises the built-in defaults as real rows. Idempotent: `update: {}`
 * means an admin who already edited a category is never overwritten by a
 * re-run.
 */
export async function seedDefaults(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const category of CONNECTION_CATEGORY_DEFAULTS) {
    const existing = await prisma.connectionCategory.findUnique({ where: { key: category.key } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.connectionCategory.create({
      data: {
        key: category.key,
        label: category.label,
        description: category.description,
        chatEnabled: category.chatEnabled,
        callEnabled: category.callEnabled,
        videoEnabled: category.videoEnabled,
        isPaid: category.isPaid,
        chatPricePerMinute: category.chatPricePerMinute,
        callPricePerMinute: category.callPricePerMinute,
        videoPricePerMinute: category.videoPricePerMinute,
        enabled: category.enabled,
        sortOrder: category.sortOrder,
      },
    });
    created += 1;
  }
  return { created, skipped };
}

/**
 * `isPaid` is derived rather than set by the caller: a stored flag that could
 * disagree with the actual per-mode prices would be a lie the billing engine
 * would later have to reconcile. A category is paid iff at least one mode that
 * is switched on actually costs something.
 */
function deriveIsPaid(input: {
  chatEnabled: boolean;
  callEnabled: boolean;
  videoEnabled: boolean;
  chatPricePerMinute: number;
  callPricePerMinute: number;
  videoPricePerMinute: number;
}): boolean {
  return (
    (input.chatEnabled && input.chatPricePerMinute > 0) ||
    (input.callEnabled && input.callPricePerMinute > 0) ||
    (input.videoEnabled && input.videoPricePerMinute > 0)
  );
}

/**
 * Creating into an empty table would leave the admin with a catalogue of one
 * and silently hide the other nine shipped categories (the read path only
 * falls back to defaults when there are *no* rows), so seed first.
 */
export async function createCategory(input: CategoryInput): Promise<ConnectionCategoryShape> {
  const data = normalizeCategoryInput(input);
  const seeded = await listAll();
  if (seeded.source === "defaults") {
    await seedDefaults();
  }

  const values = {
    chatEnabled: Boolean(data.chatEnabled ?? true),
    callEnabled: Boolean(data.callEnabled ?? true),
    videoEnabled: Boolean(data.videoEnabled ?? false),
    chatPricePerMinute: Number(data.chatPricePerMinute ?? 0),
    callPricePerMinute: Number(data.callPricePerMinute ?? 0),
    videoPricePerMinute: Number(data.videoPricePerMinute ?? 0),
  };

  const row = await prisma.connectionCategory.create({
    data: {
      key: String(data.key ?? ""),
      label: String(data.label ?? ""),
      description: (data.description as string | null) ?? null,
      ...values,
      isPaid: deriveIsPaid(values),
      enabled: Boolean(data.enabled ?? true),
      sortOrder: Number(data.sortOrder ?? 0),
    },
  });
  return serializeCategory(row);
}

export async function updateCategory(id: string, input: CategoryInput): Promise<ConnectionCategoryShape | null> {
  const existing = await prisma.connectionCategory.findUnique({ where: { id } });
  if (!existing) return null;
  const data = normalizeCategoryInput(input);

  // Merge onto the stored row so a partial update re-derives `isPaid` from the
  // *combined* result, not just the fields that happened to be in the patch.
  const merged = {
    chatEnabled: data.chatEnabled !== undefined ? Boolean(data.chatEnabled) : existing.chatEnabled,
    callEnabled: data.callEnabled !== undefined ? Boolean(data.callEnabled) : existing.callEnabled,
    videoEnabled: data.videoEnabled !== undefined ? Boolean(data.videoEnabled) : existing.videoEnabled,
    chatPricePerMinute:
      data.chatPricePerMinute !== undefined ? Number(data.chatPricePerMinute) : Number(existing.chatPricePerMinute ?? 0),
    callPricePerMinute:
      data.callPricePerMinute !== undefined ? Number(data.callPricePerMinute) : Number(existing.callPricePerMinute ?? 0),
    videoPricePerMinute:
      data.videoPricePerMinute !== undefined
        ? Number(data.videoPricePerMinute)
        : Number(existing.videoPricePerMinute ?? 0),
  };

  const row = await prisma.connectionCategory.update({
    where: { id },
    data: { ...data, isPaid: deriveIsPaid(merged) },
  });
  return serializeCategory(row);
}

export async function deleteCategory(id: string): Promise<boolean> {
  const existing = await prisma.connectionCategory.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.connectionCategory.delete({ where: { id } });
  return true;
}
