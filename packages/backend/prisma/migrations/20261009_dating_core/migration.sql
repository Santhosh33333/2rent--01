-- Dating core: Like / Pass / Match
-- Greenfield and independent of the legacy Booking/Partner flow.
-- No existing table is modified except additive columns on "User".

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "newUserUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Like" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Like_fromUserId_toUserId_key" ON "Like"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Like_toUserId_createdAt_idx" ON "Like"("toUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_fromUserId_toUserId_key" ON "Pass"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "Pass_toUserId_idx" ON "Pass"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_userAId_userBId_key" ON "Match"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "Match_userAId_lastMessageAt_idx" ON "Match"("userAId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Match_userBId_lastMessageAt_idx" ON "Match"("userBId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;