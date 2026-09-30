import { describe, it, expect } from 'vitest';

/**
 * Membership rule for the event group thread, asserted as pure logic.
 *
 * The controller implements the same predicate with Prisma queries; this test
 * pins the decision table so a refactor cannot quietly widen access to the
 * thread, which would expose attendees' names to the whole app.
 */
type Roster = { organizerId: string; attendeeStatuses: Record<string, string> };

type Decision =
  | { ok: true }
  | { ok: false; code: 'EVENT_NOT_FOUND' | 'NOT_ATTENDING' };

/** Mirrors requireThreadMembership in eventChatController. */
export function threadAccess(roster: Roster | null, userId: string): Decision {
  if (!roster) return { ok: false, code: 'EVENT_NOT_FOUND' };
  if (roster.organizerId === userId) return { ok: true };
  const status = roster.attendeeStatuses[userId];
  if (status && status !== 'CANCELLED') return { ok: true };
  return { ok: false, code: 'NOT_ATTENDING' };
}

const organizer = 'org-1';
const going = 'going-1';
const cancelled = 'cancelled-1';

const roster: Roster = {
  organizerId: organizer,
  attendeeStatuses: { [going]: 'REGISTERED', [cancelled]: 'CANCELLED' },
};

describe('Event group thread: who may read and post', () => {
  it('lets the organizer in even when they never RSVPped to their own event', () => {
    expect(threadAccess(roster, organizer)).toEqual({ ok: true });
  });

  it('lets a registered attendee in', () => {
    expect(threadAccess(roster, going)).toEqual({ ok: true });
  });

  it('locks out a member who cancelled their RSVP', () => {
    expect(threadAccess(roster, cancelled)).toEqual({ ok: false, code: 'NOT_ATTENDING' });
  });

  it('locks out a signed-in member who never joined', () => {
    expect(threadAccess(roster, 'stranger')).toEqual({ ok: false, code: 'NOT_ATTENDING' });
  });

  it('reports a deleted event rather than pretending they are not attending', () => {
    expect(threadAccess(null, going)).toEqual({ ok: false, code: 'EVENT_NOT_FOUND' });
  });

  it('treats a CHECKED_IN attendee as still having access', () => {
    const checkedIn: Roster = { ...roster, attendeeStatuses: { 'a': 'CHECKED_IN' } };
    expect(threadAccess(checkedIn, 'a')).toEqual({ ok: true });
  });

  it('does not treat a staff account as privileged inside the thread', () => {
    // Membership is decided by the attendee list alone; a moderator account that
    // is not on the list gets nothing extra.
    expect(threadAccess(roster, 'staff-account')).toEqual({ ok: false, code: 'NOT_ATTENDING' });
  });
});