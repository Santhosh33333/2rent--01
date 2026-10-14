import { prisma } from "../config/database";

/**
 * Find-or-create the canonical Conversation row for a pair of users.
 *
 * Uses an atomic upsert on the unique (participant1Id, participant2Id) pair so
 * two concurrent first messages between the same pair can never create
 * duplicate Conversation rows (the previous find-then-create had a TOCTOU race
 * that 500'd).
 *
 * Lives in its own module — importing only prisma — so lightweight callers
 * (e.g. the signup welcome) do not drag in the whole messaging controller and,
 * with it, the auth/env graph.
 */
export async function ensureConversation(a: string, b: string) {
  const [p1, p2] = [a, b].sort();
  return prisma.conversation.upsert({
    where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
    create: { participant1Id: p1, participant2Id: p2 },
    update: {},
  });
}
