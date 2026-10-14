-- General-purpose group chat: named groups with invited membership.
--
-- Deliberately NOT built on Conversation, which is strictly two-party
-- (participant1/participant2 with a unique pair). See the schema note on
-- EventGroupMessage for the same reasoning. A group has its own member list,
-- message stream and invite queue.
--
-- Idempotent for a database bootstrapped with `prisma db push`, which already
-- has these tables. A failing migration stops `prisma migrate deploy`, which
-- stops the container booting, so the guards are deliberate.

CREATE TABLE IF NOT EXISTS "ChatGroup" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "avatarUrl"   TEXT,
  "createdById" TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatGroupMember" (
  "id"         TEXT NOT NULL,
  "groupId"    TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "role"       TEXT NOT NULL DEFAULT 'MEMBER',
  "lastReadAt" TIMESTAMP(3),
  "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatGroupMessage" (
  "id"          TEXT NOT NULL,
  "groupId"     TEXT NOT NULL,
  "senderId"    TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'TEXT',
  "mediaUrl"    TEXT,
  "replyToId"   TEXT,
  "reactions"   JSONB,
  "status"      TEXT NOT NULL DEFAULT 'SENT',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatGroupMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatGroupInvite" (
  "id"          TEXT NOT NULL,
  "groupId"     TEXT NOT NULL,
  "inviterId"   TEXT NOT NULL,
  "inviteeId"   TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "message"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "ChatGroupInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatGroup_createdById_idx" ON "ChatGroup"("createdById");

CREATE UNIQUE INDEX IF NOT EXISTS "ChatGroupMember_groupId_userId_key" ON "ChatGroupMember"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "ChatGroupMember_userId_idx" ON "ChatGroupMember"("userId");

CREATE INDEX IF NOT EXISTS "ChatGroupMessage_groupId_createdAt_idx" ON "ChatGroupMessage"("groupId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ChatGroupInvite_groupId_inviteeId_key" ON "ChatGroupInvite"("groupId", "inviteeId");
CREATE INDEX IF NOT EXISTS "ChatGroupInvite_inviteeId_status_idx" ON "ChatGroupInvite"("inviteeId", "status");

DO $$
BEGIN
  ALTER TABLE "ChatGroup"
    ADD CONSTRAINT "ChatGroup_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupMember"
    ADD CONSTRAINT "ChatGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupMember"
    ADD CONSTRAINT "ChatGroupMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupMessage"
    ADD CONSTRAINT "ChatGroupMessage_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupMessage"
    ADD CONSTRAINT "ChatGroupMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupMessage"
    ADD CONSTRAINT "ChatGroupMessage_replyToId_fkey"
    FOREIGN KEY ("replyToId") REFERENCES "ChatGroupMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupInvite"
    ADD CONSTRAINT "ChatGroupInvite_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupInvite"
    ADD CONSTRAINT "ChatGroupInvite_inviterId_fkey"
    FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ChatGroupInvite"
    ADD CONSTRAINT "ChatGroupInvite_inviteeId_fkey"
    FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
