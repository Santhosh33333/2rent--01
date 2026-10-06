-- Global social feed (Post/PostComment/PostLike/PostSave/PostReport/Gift)
-- Generated from the schema diff by hand: the local dev database is several
-- commits behind the migration folder, so a --from-schema-datasource diff
-- picked up unrelated drift. Only the six tables below belong to this
-- migration. FKs on all new tables are real (unlike the legacy Report table,
-- whose targetId still hard-foreign-keys to User.id and is therefore NOT used
-- for feed post reports).

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "locationArea" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSave" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");

-- CreateIndex
CREATE INDEX "Post_status_visibility_createdAt_idx" ON "Post"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");

-- CreateIndex
CREATE INDEX "PostLike_userId_idx" ON "PostLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostLike_postId_userId_key" ON "PostLike"("postId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostSave_postId_userId_key" ON "PostSave"("postId", "userId");

-- CreateIndex
CREATE INDEX "PostReport_postId_idx" ON "PostReport"("postId");

-- CreateIndex
CREATE INDEX "PostReport_status_idx" ON "PostReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Gift_referenceId_key" ON "Gift"("referenceId");

-- CreateIndex
CREATE INDEX "Gift_postId_idx" ON "Gift"("postId");

-- CreateIndex
CREATE INDEX "Gift_recipientId_createdAt_idx" ON "Gift"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Gift_senderId_createdAt_idx" ON "Gift"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSave" ADD CONSTRAINT "PostSave_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSave" ADD CONSTRAINT "PostSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReport" ADD CONSTRAINT "PostReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReport" ADD CONSTRAINT "PostReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feature flags for the spec's module catalogue. Only flags whose feature is
-- actually wired end to end are enabled. Everything else stays OFF so clients
-- never see a feature that isn't really available.
INSERT INTO "FeatureFlag" ("id", "key", "name", "description", "isEnabled", "rolloutPercentage", "updatedAt")
VALUES
  (gen_random_uuid(), 'POSTS', 'Social posts', 'Global feed posts with photo/video, likes, comments, save and report.', true, 100, now()),
  (gen_random_uuid(), 'GIFTING', 'Post gifts', 'Send a wallet gift that debits the sender and credits the post author.', true, 100, now()),
  (gen_random_uuid(), 'SAVED', 'Saved center', 'Save posts to a personal saved collection.', true, 100, now()),
  (gen_random_uuid(), 'REACTIONS', 'Post reactions', 'Richer post reactions (LOVE, HAHA, WOW). Slots exist in PostLike.type; UI stays on LIKE until switched on.', false, 0, now()),
  (gen_random_uuid(), 'STORIES', 'Stories', '24-hour photo/video/text stories.', false, 0, now()),
  (gen_random_uuid(), 'SHORT_VIDEOS', 'Short videos', 'TikTok/Reels-style vertical video feed.', false, 0, now()),
  (gen_random_uuid(), 'TRAVEL', 'Travel', 'Travel plans, companions and itineraries.', false, 0, now()),
  (gen_random_uuid(), 'CREATOR_MODE', 'Creator mode', 'Creator profiles, followers and analytics.', false, 0, now()),
  (gen_random_uuid(), 'BUSINESS_PROFILES', 'Business profiles', 'Verified business and organization profiles.', false, 0, now()),
  (gen_random_uuid(), 'LIVE_EVENTS', 'Live events', 'Event livestreams and live discussions.', false, 0, now()),
  (gen_random_uuid(), 'LIVE_STREAMING', 'Live streaming', 'General live video/audio rooms.', false, 0, now()),
  (gen_random_uuid(), 'AI_ASSISTANT', 'AI assistant', 'Nabri AI social assistant.', false, 0, now()),
  (gen_random_uuid(), 'LOCAL_DISCOVERY', 'Local discovery', 'Nearby places and activities.', false, 0, now())
ON CONFLICT ("key") DO NOTHING;