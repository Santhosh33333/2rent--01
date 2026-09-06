-- Community polls (spec 104): one vote per user per poll, changeable.
-- Vote counts are maintained transactionally with the vote rows.

CREATE TABLE IF NOT EXISTS "CommunityPoll" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "closesAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityPoll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunityPollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "voteCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CommunityPollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunityPollVote" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "CommunityPollVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityPollVote_pollId_userId_key" ON "CommunityPollVote"("pollId", "userId");
CREATE INDEX IF NOT EXISTS "CommunityPoll_communityId_createdAt_idx" ON "CommunityPoll"("communityId", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunityPollOption_pollId_idx" ON "CommunityPollOption"("pollId");
CREATE INDEX IF NOT EXISTS "CommunityPollVote_optionId_idx" ON "CommunityPollVote"("optionId");

ALTER TABLE "CommunityPoll" ADD CONSTRAINT "CommunityPoll_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPoll" ADD CONSTRAINT "CommunityPoll_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPollOption" ADD CONSTRAINT "CommunityPollOption_pollId_fkey"
  FOREIGN KEY ("pollId") REFERENCES "CommunityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_pollId_fkey"
  FOREIGN KEY ("pollId") REFERENCES "CommunityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "CommunityPollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityPollVote" ADD CONSTRAINT "CommunityPollVote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
