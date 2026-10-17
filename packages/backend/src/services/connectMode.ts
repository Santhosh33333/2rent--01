/**
 * The booker's session channel (call vs chat) and how a partner's two
 * capability flags answer it.
 *
 * `Partner.providesWalking` / `Partner.providesCarry` are the legacy column
 * names, but they now answer the only two choices the apply screen offers:
 * "Call sessions" and "Chat sessions". Matching kept asking the *retired*
 * catalogue instead — `serviceType === "WALKING" ? providesWalking :
 * providesCarry` — so a partner who ticked one option only was shown nothing
 * (no live booking is `WALKING`/`CARRY_BUDDY` any more) while dispatch fanned
 * every job out to call-capable partners alone.
 *
 * The channel is read from `Booking.notes`, where the booking page has always
 * recorded it ("Connect by call" / "Connect by chat"). That is deliberately not
 * a new column: reminders only rewrite `notes` for bookings that are already
 * accepted — long after matching — and older bookings simply resolve to
 * "unspecified" and keep matching every approved partner, so nothing that works
 * today stops working.
 */

export type ConnectMode = "CALL" | "CHAT";

const MARKER = /Connect by (call|chat)\b/i;

/** The channel recorded on a booking, or null when it was never specified. */
export function connectModeFromNotes(notes: string | null | undefined): ConnectMode | null {
  if (!notes) return null;

  let text = notes;
  const trimmed = notes.trim();
  if (trimmed.startsWith("{")) {
    // Notes are also used as a small JSON bag (same-gender preference, reminders).
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.connectMode === "CALL" || parsed.connectMode === "CHAT") return parsed.connectMode;
      const candidate = [parsed.text, parsed.notes, parsed.note, parsed.body].find(
        (value): value is string => typeof value === "string"
      );
      if (!candidate) return null;
      text = candidate;
    } catch {
      text = trimmed;
    }
  }

  const match = MARKER.exec(text);
  return match ? (match[1].toUpperCase() as ConnectMode) : null;
}

/**
 * Record the channel on a booking's notes, once.
 *
 * The marker goes first so the plain-text notes a person reads still open with
 * it; an already-recorded marker is left exactly as it is.
 */
export function withConnectMode(notes: string | undefined, mode: ConnectMode | undefined): string | undefined {
  if (!mode) return notes;
  const marker = `Connect by ${mode === "CALL" ? "call" : "chat"}`;
  if (notes && MARKER.test(notes)) return notes;
  const body = typeof notes === "string" ? notes.trim() : "";
  return body ? `${marker} — ${body}` : marker;
}

/** Prisma `where` fragment: only partners who take this channel. */
export function capabilityFilter(mode: ConnectMode | null): { providesWalking?: boolean; providesCarry?: boolean } {
  if (mode === "CALL") return { providesWalking: true };
  if (mode === "CHAT") return { providesCarry: true };
  return {};
}

/**
 * Can this partner take this job?
 *
 * An unspecified channel matches everyone, and so does a partner who recorded
 * no preference at all — an approved partner must not be starved of work by a
 * field they were never asked to fill.
 */
export function partnerServes(
  partner: { providesWalking: boolean; providesCarry: boolean },
  mode: ConnectMode | null
): boolean {
  if (mode === null) return true;
  if (!partner.providesWalking && !partner.providesCarry) return true;
  return mode === "CALL" ? partner.providesWalking : partner.providesCarry;
}

/**
 * Channel for a booking about to be matched.
 *
 * The two retired catalogue keys keep the mapping they had before, so historic
 * walking/carry rows still reach the partners who used to take them.
 */
export function connectModeForBooking(booking: { serviceType: string; notes?: string | null }): ConnectMode | null {
  if (booking.serviceType === "WALKING") return "CALL";
  if (booking.serviceType === "CARRY_BUDDY") return "CHAT";
  return connectModeFromNotes(booking.notes);
}
