-- Event group thread: the attendees of an event talking to each other, which is
-- what makes the group feel real ("who's coming?", "which corner?").
--
-- Deliberately a new table rather than a Conversation with a third participant:
-- Conversation is strictly two-party (participant1Id/participant2Id, unique
-- pair), and every unread count, socket fan-out and list query in the 1:1
-- messenger assumes exactly two people. Group membership here comes from the
-- EventAttendee table, not from invitations, so it does not fit that model at
-- all. Access is enforced in eventChatController, not by this constraint.
--
-- Additive only, matching the 20260930/20261006 style. IF NOT EXISTS keeps it
-- idempotent against the boot-time schema reconciliation in src/server.ts.
CREATE TABLE IF NOT EXISTS "EventGroupMessage" (
    "id"          TEXT NOT NULL,
    "eventId"     TEXT NOT NULL,
    "senderId"    TEXT NOT NULL,
    "content"     TEXT NOT NULL DEFAULT '',
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "mediaUrl"    TEXT,
    "status"      TEXT NOT NULL DEFAULT 'SENT',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventGroupMessage_pkey" PRIMARY KEY ("id")
);

-- Thread reads are always "this event, newest last", so the composite index is
-- the one that matters: it serves both the page query and the message count.
CREATE INDEX IF NOT EXISTS "EventGroupMessage_eventId_createdAt_idx"
    ON "EventGroupMessage" ("eventId", "createdAt");

-- Deleting an event takes its thread with it; deleting a user removes only their
-- messages, matching the 1:1 messenger's Cascade on sender.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EventGroupMessage_eventId_fkey'
    ) THEN
        ALTER TABLE "EventGroupMessage"
            ADD CONSTRAINT "EventGroupMessage_eventId_fkey"
            FOREIGN KEY ("eventId") REFERENCES "Event"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EventGroupMessage_senderId_fkey'
    ) THEN
        ALTER TABLE "EventGroupMessage"
            ADD CONSTRAINT "EventGroupMessage_senderId_fkey"
            FOREIGN KEY ("senderId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;