/**
 * Offline rule router for the Nabri assistant.
 *
 * The assistant normally plans with an LLM and calls tools through the registry.
 * When no provider is configured (the "own AI, no external API" mode) the
 * assistant must still answer, so this module maps a message to one of the
 * READ-ONLY tools in the registry using transparent keyword rules, and composes
 * a reply strictly from the tool's returned data.
 *
 * Guarantees, matching the rest of the agent:
 * - Nothing is invented. Every sentence is built from a tool's real payload, and
 *   a tool that returns nothing is reported as nothing.
 * - No write is ever auto-routed. Actions that change data or move money stay
 *   behind the normal confirmation flow, or are guided to the relevant screen.
 * - Role filtering happens upstream: the `allowed` set only contains tools the
 *   caller may invoke, so an admin tool is unreachable for a normal account.
 */

export interface RoutedCall {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Result of routing one message. `guidance` is set instead of `calls` when the
 * request is an action the assistant must not perform on its own.
 */
export interface RouteResult {
  calls: RoutedCall[];
  guidance?: string;
}

/** Structurally identical to the agent service's AgentToolActivity. */
export interface RuleActivity {
  toolName: string;
  status: "success" | "denied" | "failed" | "confirmation_required";
  summary: string;
  data?: unknown;
}

// --- helpers ---------------------------------------------------------------

const CITIES = new Set<string>([
  "mumbai", "delhi", "bengaluru", "bangalore", "hyderabad", "ahmedabad", "chennai",
  "kolkata", "pune", "surat", "jaipur", "lucknow", "kanpur", "nagpur", "indore",
  "thane", "bhopal", "visakhapatnam", "patna", "vadodara", "ghaziabad", "ludhiana",
  "agra", "nashik", "faridabad", "meerut", "rajkot", "varanasi", "srinagar",
  "aurangabad", "dhanbad", "amritsar", "ranchi", "howrah", "coimbatore", "jabalpur",
  "gwalior", "vijayawada", "jodhpur", "madurai", "raipur", "kota", "guwahati",
  "chandigarh", "solapur", "hubballi", "mysuru", "mysore", "tiruchirappalli",
  "bareilly", "aligarh", "kochi", "cochin", "ernakulam", "trivandrum",
  "thiruvananthapuram", "goa", "panaji", "dehradun", "shimla", "jalandhar",
  "gurgaon", "gurugram", "noida", "tirupati", "warangal", "salem", "tirunelveli",
  "vellore", "pondicherry", "puducherry", "cuttack", "bhubaneswar", "siliguri",
  "jamshedpur", "udaipur", "ajmer", "kolhapur", "sangli", "amravati", "akola",
  "latur", "jalgaon", "dhule", "nanded", "parbhani", "satara", "ratnagiri",
]);

const STOP = new Set<string>([
  "show", "me", "my", "mine", "find", "get", "list", "what", "whats", "are", "is",
  "the", "a", "an", "any", "some", "please", "can", "you", "i", "want", "need",
  "tell", "about", "for", "to", "of", "and", "or", "in", "near", "around", "at",
  "from", "on", "do", "does", "have", "has", "there", "here", "now", "today",
  "tomorrow", "tonight", "this", "that", "week", "weekend", "evening", "morning",
  "night", "event", "events", "sport", "sports", "game", "games", "movie",
  "movies", "film", "films", "cinema", "partner", "partners", "buddy", "companion",
  "community", "communities", "club", "clubs", "group", "groups", "wallet",
  "balance", "money", "payment", "payments", "pay", "paid", "notification",
  "notifications", "unread", "alert", "alerts", "inbox", "booking", "bookings",
  "request", "requests", "ride", "rides", "order", "orders", "book", "walk",
  "walks", "walking", "carry", "help", "support", "ticket", "tickets", "issue",
  "issues", "problem", "problems", "complaint", "how", "much", "many", "did",
  "was", "were", "been", "am", "be", "with", "without", "your", "yours", "our",
  "us", "we", "they", "their", "them", "his", "her", "she", "he", "it", "its",
  "if", "then", "than", "so", "not", "no", "yes", "ok", "okay", "hey", "hi",
  "hello", "thanks", "thank", "also", "just", "only", "more", "most", "all",
  "out", "up", "down", "over", "under", "again", "good", "best", "top",
]);

/** Tokens that can follow "in/near" but are never a city. */
const NON_CITY_WORDS = new Set(["me", "my", "your", "here", "there", "town", "city", "the", "a"]);

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function title(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/** A city named anywhere in the message, preferring an explicit "in/near X". */
export function extractCity(message: string): string | undefined {
  const lower = message.toLowerCase();
  for (const multi of ["new delhi", "navi mumbai"]) {
    const re = new RegExp(`\\b${multi.replace(/ /g, "\\s+")}\\b`);
    if (re.test(lower)) return title(multi);
  }
  const explicit = lower.match(/\b(?:in|near|around|from)\s+([a-z][a-z'-]{1,25})\b/);
  if (explicit) {
    const cand = explicit[1];
    if (!NON_CITY_WORDS.has(cand) && CITIES.has(cand)) return title(cand);
  }
  for (const w of words(message)) {
    if (CITIES.has(w)) return title(w);
  }
  return undefined;
}

function extractService(message: string): "walking" | "carry" | undefined {
  if (/\b(carry|carrying|deliver|delivery|luggage|parcel|pick\s?up|drop)\b/i.test(message)) return "carry";
  if (/\b(walk|walking|accompany|companion|escort)\b/i.test(message)) return "walking";
  return undefined;
}

function salientQuery(message: string): string | undefined {
  const toks = words(message).filter((w) => w.length > 2 && !STOP.has(w));
  if (!toks.length) return undefined;
  return toks.slice(0, 3).join(" ").slice(0, 80);
}

function eventCategory(message: string): string | undefined {
  if (
    /\b(sport|sports|game|games|cricket|football|badminton|tennis|basketball|run|running|cycling|swim|gym|match|player|team)\b/i.test(
      message,
    )
  ) {
    return "sports";
  }
  if (/\b(movie|movies|film|films|cinema)\b/i.test(message)) return "movies";
  return undefined;
}

function eventArgs(message: string): Record<string, unknown> {
  return compact({
    query: salientQuery(message),
    city: extractCity(message),
    category: eventCategory(message),
    limit: 5,
  });
}

function partnerArgs(message: string): Record<string, unknown> {
  return compact({
    city: extractCity(message),
    service: extractService(message),
    radiusKm: 10,
  });
}

function communityArgs(message: string): Record<string, unknown> {
  return compact({ query: salientQuery(message), city: extractCity(message), limit: 5 });
}

// --- routing ---------------------------------------------------------------

const ADMIN_WORDS = /\b(stats|platform stats|overview|metrics|dashboard|how many users|total users)\b/i;
const FIND_USER = /\b(find user|look ?up user|search user|user (?:by|with) (?:email|phone|name)|who is)\b/i;

/** admin_find_user takes exactly one of id/email/phone, so extract what is there. */
function findUserArgs(message: string): Record<string, unknown> {
  const uuid = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return { id: uuid[0] };
  const email = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) return { email: email[0] };
  const phone = message.match(/\+?\d[\d\s-]{5,}/);
  if (phone && phone[0].replace(/\D/g, "").length >= 6) return { phone: phone[0].replace(/[\s-]/g, "") };
  // Nothing usable: passing {} is valid and the handler answers MISSING_IDENTIFIER,
  // which the reply surfaces as "provide an id, email or phone".
  return {};
}

/**
 * Route one message to zero or more read-only tool calls. `allowed` is the set
 * of tool names the caller's role may invoke.
 */
export function routeMessage(message: string, allowed: Set<string>): RouteResult {
  // A clear action request is answered with guidance up front: these verbs have
  // no sensible read interpretation, and routing "cancel my booking" to the
  // requests list would be unhelpful. Softer wording (e.g. "withdraw") still
  // falls through to a read and only gets guidance when nothing matched.
  const hard = hardActionGuidance(message);
  if (hard) return { calls: [], guidance: hard };

  const has = (n: string) => allowed.has(n);
  let call: RoutedCall | undefined;

  const first = (toolName: string, args: Record<string, unknown>, test: RegExp | boolean): void => {
    if (call) return;
    if (!has(toolName)) return;
    const matched = typeof test === "boolean" ? test : test.test(message);
    if (!matched) return;
    call = { toolName, args };
  };

  // Admin reads (only reachable when the caller actually holds them).
  first("admin_get_platform_stats", {}, ADMIN_WORDS);
  first("admin_find_user", findUserArgs(message), FIND_USER);
  first("admin_list_withdrawals", {}, /\bwithdrawals?\b/i);

  // Partner reads run before generic money so "withdraw" hits the right tool.
  first("get_my_earnings", {}, /\bearnings?|income|how much (?:did|have) i (?:make|made|earn)|my payout/i);
  first("get_my_withdrawals", { limit: 5 }, /\bwithdraw|withdrawal|payout|cash ?out\b/i);
  first(
    "get_my_partner_status",
    {},
    /\bpartner status|am i (?:a )?partner|approved partner|partner application|become a partner|can i accept (?:walks|jobs)\b/i,
  );

  first("get_my_subscription", {}, /\bsubscription|subscribe|membership|premium|my plan|renew|trial|expire/i);

  first(
    "get_notifications",
    { unreadOnly: /\bunread\b/i.test(message), limit: 10 },
    /\bnotifications?|alerts?|inbox|unread|messages?\b/i,
  );

  first("get_active_request", {}, /\bactive (?:request|booking)|current (?:request|booking)|in ?progress|ongoing\b/i);

  first("get_my_requests", { limit: 5 }, /\b(?:my |the )?(?:requests?|bookings?|orders?|rides?)\b/i);

  first("get_wallet", { limit: 5 }, /\bwallet|balance|my money\b/i);

  first("get_payment_history", { limit: 5 }, /\bpayments?|paid|refunds?|transactions?|invoices?|receipts?\b/i);

  first("get_my_profile", {}, /\bprofile|account|kyc|verif|aadhaar|selfie|my name|my (?:phone|email|city)\b/i);

  first("get_support_information", {}, /\bsupport|tickets?|complaints?|issues?|problems?|complaint|not working|help me with\b/i);

  first("search_communities", communityArgs(message), /\bcommunities|community|clubs?|groups?|forum\b/i);

  first(
    "search_partners",
    partnerArgs(message),
    /\bpartners?|buddy|companions?|someone to (?:walk|carry)|walking partner|help me (?:walk|carry)|carry my\b/i,
  );

  first(
    "search_events",
    eventArgs(message),
    /\bevents?|sports?|games?|cricket|football|badminton|tennis|basketball|movies?|films?|cinema|activities|activity|things to do|what'?s on|tonight|tomorrow|weekend|this week|near me|happening\b/i,
  );

  if (call) return { calls: [call] };
  return { calls: [], guidance: guidanceFor(message) };
}

/** A screen to send the user to for an action the assistant must not auto-run. */
function guidanceFor(message: string): string | undefined {
  if (/\b(book|schedule|create (?:a )?(?:walk|request|booking)|new booking|request a (?:walk|partner))\b/i.test(message)) {
    return "To create a request, open Bookings and tap New — I don't create bookings directly from chat.";
  }
  if (/\bcancel\b/i.test(message)) {
    return "To cancel, open the booking or request in the app and choose Cancel. I won't cancel it from chat.";
  }
  if (/\bjoin\b/i.test(message)) {
    return "To join an event, open it from Events and tap Join.";
  }
  if (/\breport\b/i.test(message)) {
    return "To report someone, open their profile and choose Report.";
  }
  if (/\bwithdraw|cash ?out\b/i.test(message)) {
    return "To withdraw, open your wallet and choose Withdraw — an admin reviews the request.";
  }
  return undefined;
}

/**
 * Action guidance for the verbs that must never be answered by listing data:
 * an imperative "cancel ..." is a cancellation request, not a request for the
 * user's booking list. Only a leading verb (optionally behind a polite preface)
 * counts, so "my booking was cancelled" still reads as a list query.
 */
function hardActionGuidance(message: string): string | undefined {
  const prefix = "(?:please\\s+|can you\\s+|could you\\s+|i want to\\s+|i need to\\s+|help me\\s+)?";
  const m = message.trim();
  if (new RegExp(`^${prefix}(?:book|schedule)\\b`, "i").test(m)) {
    return "To create a request, open Bookings and tap New — I don't create bookings directly from chat.";
  }
  if (new RegExp(`^${prefix}cancel\\b`, "i").test(m)) {
    return "To cancel, open the booking or request in the app and choose Cancel. I won't cancel it from chat.";
  }
  if (new RegExp(`^${prefix}join\\b`, "i").test(m)) {
    return "To join an event, open it from Events and tap Join.";
  }
  if (new RegExp(`^${prefix}report\\b`, "i").test(m)) {
    return "To report someone, open their profile and choose Report.";
  }
  return undefined;
}

/** Honest list of what the offline assistant can do for this role. */
export function ruleHelp(allowed: Set<string>): string {
  const can: string[] = [];
  if (allowed.has("search_events")) can.push("events and things to do");
  if (allowed.has("search_partners")) can.push("walking or carry partners");
  if (allowed.has("search_communities")) can.push("communities");
  if (allowed.has("get_wallet") || allowed.has("get_payment_history")) can.push("your wallet and payments");
  if (allowed.has("get_my_requests") || allowed.has("get_active_request")) can.push("your requests");
  if (allowed.has("get_notifications")) can.push("your notifications");
  if (allowed.has("get_my_subscription")) can.push("your subscription");
  if (allowed.has("get_my_earnings") || allowed.has("get_my_withdrawals")) can.push("your earnings and withdrawals");
  const list = can.length ? can.join(", ") : "your account";
  return `I can help with ${list}. Try: "something to do this weekend", "find a walking partner", "my wallet balance", or "my recent payments".`;
}

// --- reply composition -----------------------------------------------------

function money(v: unknown, currency = "INR"): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toFixed(2)}`;
}

function shortTime(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function genericSummary(data: unknown): string {
  if (data === null || data === undefined) return "Done.";
  if (typeof data !== "object") return String(data).slice(0, 400);
  const out: string[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    out.push(`${k}: ${String(v)}`);
    if (out.length >= 6) break;
  }
  return out.length ? out.join(", ") : "Done.";
}

/** Compose a grounded reply from the executed (read-only) tool outcomes. */
export function composeRuleReply(activity: RuleActivity[]): string {
  if (!activity.length) return "I couldn't find anything for that.";
  const parts: string[] = [];
  for (const a of activity) {
    if (a.status === "denied" || a.status === "failed") {
      parts.push(a.summary);
      continue;
    }
    parts.push(formatSuccess(a.toolName, a.data));
  }
  return parts.filter(Boolean).join("\n\n") || "Done.";
}

function formatSuccess(toolName: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, any>;
  switch (toolName) {
    case "get_wallet": {
      if (!d.wallet) return "No wallet is set up on this account yet.";
      let s = `Wallet balance: ${money(d.wallet.balance, d.wallet.currency)}.`;
      if (Number(d.wallet.promotionalBalance) > 0) {
        s += ` Promotional: ${money(d.wallet.promotionalBalance, d.wallet.currency)}.`;
      }
      if (Number(d.wallet.heldBalance) > 0) {
        s += ` Held: ${money(d.wallet.heldBalance, d.wallet.currency)}.`;
      }
      const rows: any[] = Array.isArray(d.transactions) ? d.transactions.slice(0, 5) : [];
      if (rows.length) {
        const lines = rows.map((t: any) => `• ${money(t.amount)} — ${t.type} (${t.status})`);
        s += `\nRecent:\n${lines.join("\n")}`;
      }
      return s;
    }
    case "get_payment_history": {
      const rows: any[] = Array.isArray(d.payments) ? d.payments : [];
      if (!d.count || !rows.length) return "You have no payments on record.";
      const lines = rows
        .slice(0, 5)
        .map((p: any) => `• ${money(p.amount, p.currency)} — ${p.status}${p.type ? ` (${p.type})` : ""}`);
      return `Your recent payments (${d.count}):\n${lines.join("\n")}`;
    }
    case "get_my_subscription": {
      if (!d.hasSubscription) {
        return d.accessUntil
          ? `No subscription record. Access is valid until ${shortTime(d.accessUntil)}.`
          : "You don't have a subscription yet.";
      }
      if (d.trialActive) {
        return `You're on a free trial${d.planName ? ` (${d.planName})` : ""} with ${d.trialDaysLeft} day(s) left.`;
      }
      const bits = [`Plan: ${d.planName ?? "—"}`, `Status: ${d.status}`];
      if (d.price != null) bits.push(`Price: ${money(d.price, d.currency ?? "INR")}`);
      if (d.nextBillingAt) bits.push(`Next billing: ${shortTime(d.nextBillingAt)}`);
      return `${bits.join(". ")}.`;
    }
    case "get_notifications": {
      const rows: any[] = Array.isArray(d.notifications) ? d.notifications : [];
      const unread = Number(d.unreadCount ?? 0);
      if (!rows.length) return unread ? `You have ${unread} unread notification(s).` : "You have no notifications.";
      const lines = rows.slice(0, 5).map((n: any) => `• ${n.title}${n.read ? "" : " (unread)"}`);
      return `You have ${unread} unread. Recent:\n${lines.join("\n")}`;
    }
    case "get_active_request": {
      if (!d.hasActiveRequest || !d.request) return "You have no active request right now.";
      const r = d.request;
      return `You have an active request: ${r.from ?? "—"} → ${r.to ?? "—"}, status ${r.status}${r.fare != null ? `, ${money(r.fare)}` : ""}.`;
    }
    case "get_my_requests": {
      const rows: any[] = Array.isArray(d.requests) ? d.requests : [];
      if (!rows.length) return "You have no requests yet.";
      const lines = rows
        .slice(0, 5)
        .map((r: any) => `• ${r.status} — ${r.from ?? "—"} → ${r.to ?? "—"}${r.fare != null ? ` (${money(r.fare)})` : ""}`);
      return `Your recent requests (${rows.length}):\n${lines.join("\n")}`;
    }
    case "search_partners": {
      const rows: any[] = Array.isArray(d.partners) ? d.partners : [];
      if (!d.totalFound || !rows.length) {
        let s = "No available partners found right now.";
        if (d.excludedForMissingLocation) {
          s += ` (${d.excludedForMissingLocation} couldn't be checked for distance.)`;
        }
        return s;
      }
      const head = `I found ${d.totalFound} available partner${d.totalFound === 1 ? "" : "s"}${d.nearestKm ? ` (nearest ${d.nearestKm} km)` : ""}:`;
      const lines = rows.slice(0, 5).map(
        (p: any) =>
          `• ${p.name}${p.city ? ` — ${p.city}` : ""} (${Number(p.rating || 0).toFixed(1)}★, ${p.completedJobs || 0} jobs)${
            p.services?.length ? ` [${p.services.join(", ")}]` : ""
          }`,
      );
      return `${head}\n${lines.join("\n")}`;
    }
    case "search_events": {
      const rows: any[] = Array.isArray(d.events) ? d.events : [];
      if (!rows.length) {
        return "I couldn't find any published events for that. Want me to try a different day or place?";
      }
      const lines = rows
        .slice(0, 5)
        .map((e: any) => `• ${e.title}${e.startsAt ? ` — ${shortTime(e.startsAt)}` : ""}${e.location ? ` · ${e.location}` : ""}`);
      return `Upcoming events (${rows.length}):\n${lines.join("\n")}`;
    }
    case "search_communities": {
      const rows: any[] = Array.isArray(d.communities) ? d.communities : [];
      if (!rows.length) return "No matching communities found. You can create one and invite people.";
      const lines = rows
        .slice(0, 5)
        .map((c: any) => `• ${c.name}${c.city ? ` — ${c.city}` : ""} (${c.memberCount || 0} members)`);
      return `Communities (${rows.length}):\n${lines.join("\n")}`;
    }
    case "get_my_profile": {
      if (!d.name) return "I couldn't read your profile.";
      const verified =
        d.emailVerified && d.mobileVerified
          ? "email and mobile verified"
          : d.emailVerified
            ? "email verified, mobile not yet"
            : d.mobileVerified
              ? "mobile verified, email not yet"
              : "email and mobile not verified yet";
      return `You are ${d.name}${d.city ? ` (${d.city})` : ""}. Account: ${d.status ?? "ACTIVE"}. Verification: ${verified}.`;
    }
    case "get_support_information": {
      const rows: any[] = Array.isArray(d.tickets) ? d.tickets : [];
      if (!rows.length) {
        return "You have no support tickets. Tell me the problem and I'll help you raise one from the Support screen.";
      }
      const lines = rows.slice(0, 5).map((t: any) => `• ${t.subject} — ${t.status}`);
      return `Your support tickets (${rows.length}):\n${lines.join("\n")}`;
    }
    case "get_my_earnings":
      return `Earnings — today ${money(d.today)}, this week ${money(d.thisWeek)}, this month ${money(d.thisMonth)}, lifetime ${money(d.lifetime)}. Pending ${money(d.pending)}; withdrawable ${money(d.withdrawable)}.`;
    case "get_my_partner_status": {
      if (!d.isPartner) return d.message || "You haven't applied to be a partner yet.";
      if (d.canAcceptWalks) {
        return `You're an approved partner (rating ${Number(d.rating || 0).toFixed(1)}, ${d.totalWalks || 0} walks). You can accept walks.`;
      }
      const blockers = Array.isArray(d.blockers) && d.blockers.length ? ` Blocking you: ${d.blockers.join("; ")}.` : "";
      return `Partner status: ${d.status}.${blockers}`;
    }
    case "get_my_withdrawals": {
      const rows: any[] = Array.isArray(d.withdrawals) ? d.withdrawals : [];
      if (!rows.length) return "You have no withdrawal requests yet.";
      const lines = rows.slice(0, 5).map((w: any) => `• ${money(w.amount)} — ${w.status}`);
      return `Your withdrawals (${rows.length}):\n${lines.join("\n")}`;
    }
    default:
      return genericSummary(data);
  }
}

/** Follow-up prompts grounded in what was actually read. */
export function ruleSuggestions(activity: RuleActivity[]): string[] {
  const out = new Set<string>();
  for (const a of activity) {
    switch (a.toolName) {
      case "get_wallet":
        out.add("Show my payment history");
        break;
      case "get_payment_history":
        out.add("What is my wallet balance?");
        break;
      case "search_events":
        out.add("Find a walking partner");
        break;
      case "search_partners":
        out.add("What events are on this weekend?");
        break;
      case "get_my_subscription":
        out.add("What is my wallet balance?");
        break;
      default:
        break;
    }
  }
  out.add("Show my notifications");
  out.add("What is my wallet balance?");
  return [...out].slice(0, 3);
}
