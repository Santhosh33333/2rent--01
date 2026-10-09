-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN "invitedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FormSubmission_email_idx" ON "FormSubmission"("email");
