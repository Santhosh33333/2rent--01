import { prisma } from "../config/database";
import { isAdminTierRole } from "../rbac/activeRole";

/**
 * May `fromUserId` open (or continue) a direct chat with `toUserId`?
 *
 * A brand-new thread may only be opened from an explicit, mutual yes. That yes
 * is any of:
 *
 *   - an ACCEPTED chat request ("ask before you message"),
 *   - an ACCEPTED friendship,
 *   - an active dating Match,
 *   - a shared booking — the partner/customer thread a booking creates,
 *   - a thread that already has messages, so the rule never severs a
 *     conversation that predates it.
 *
 * Admin-tier accounts are exempt: support has to be able to reach anyone.
 *
 * Kept in one place because two transports create messages — the REST
 * `sendMessage` controller and the socket `send_message` handler — and a gate
 * enforced on only one of them is not a gate.
 */
export interface ChatAccess {
  allowed: boolean;
  reason?: "SELF" | "NOT_CONNECTED";
}

export async function canDirectChat(
  fromUserId: string,
  toUserId: string,
  callerRole?: string | null
): Promise<ChatAccess> {
  if (fromUserId === toUserId) return { allowed: false, reason: "SELF" };
  // Admins and other admin-tier staff can message anyone, by design.
  if (isAdminTierRole(callerRole)) return { allowed: true };

  const [p1, p2] = [fromUserId, toUserId].sort();

  const [conversation, acceptedRequest, friendship, match, booking] = await Promise.all([
    prisma.conversation.findUnique({
      where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
      select: { id: true, _count: { select: { messages: true } } },
    }),
    prisma.chatRequest.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: fromUserId, receiverId: toUserId },
          { senderId: toUserId, receiverId: fromUserId },
        ],
      },
      select: { id: true },
    }),
    prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: fromUserId, addresseeId: toUserId },
          { requesterId: toUserId, addresseeId: fromUserId },
        ],
      },
      select: { id: true },
    }),
    prisma.match.findFirst({
      where: {
        isActive: true,
        OR: [
          { userAId: fromUserId, userBId: toUserId },
          { userAId: toUserId, userBId: fromUserId },
        ],
      },
      select: { id: true },
    }),
    prisma.booking.findFirst({
      where: {
        OR: [
          { userId: fromUserId, partner: { userId: toUserId } },
          { userId: toUserId, partner: { userId: fromUserId } },
        ],
      },
      select: { id: true },
    }),
  ]);

  const hasMessages = (conversation?._count.messages ?? 0) > 0;
  if (hasMessages || acceptedRequest || friendship || match || booking) {
    return { allowed: true };
  }

  return { allowed: false, reason: "NOT_CONNECTED" };
}
