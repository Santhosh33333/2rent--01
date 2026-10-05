-- The admin's verdict on a statement line that did not match automatically.
--
-- Reconciliation cannot settle every line on its own: a user types their UTR,
-- the bank prints it with different spacing, or the credit landed a day outside
-- the window. Those lines land in an unmatched queue and a human decides. That
-- decision needs somewhere to live, and it must be distinguishable from the
-- machine's own `matchReason` - "no top-up claims this reference" is a parse
-- fact, whereas "checked the bank dashboard on 12 Oct, this is the same payment
-- the user submitted as UPI-4471" is a human judgement and the only thing that
-- makes the credit defensible months later.
--
-- Nullable throughout: a line that matched automatically never has a decision,
-- and a line still sitting in the queue has none yet.
--
-- `adminComment` is deliberately NOT nullable on the write path instead. The
-- service refuses to record a decision without one, which is the whole point -
-- an unexplained approval in a money flow is indistinguishable from a mistake.
ALTER TABLE "BankStatementRow"
  ADD COLUMN "adminComment" TEXT,
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decidedStatus" TEXT;

-- An index on the queue itself. The admin screen asks for "rows still needing a
-- decision" across all statements, which without this is a full scan of every
-- line of every statement ever uploaded.
CREATE INDEX "BankStatementRow_unresolved_idx"
  ON "BankStatementRow"("decidedStatus")
  WHERE "decidedAt" IS NULL;

ALTER TABLE "BankStatementRow"
  ADD CONSTRAINT "BankStatementRow_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;