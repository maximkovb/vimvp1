ALTER TABLE "users" ALTER COLUMN "balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD COLUMN "balance_before" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD COLUMN "balance_after" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD COLUMN "trade_id" text;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill balance_before / balance_after by replaying coin_transactions history per user.
-- Starting balance assumed to be 0; first row for each user is their signup_bonus (+1000).
-- COALESCE handles the first row (no preceding rows → running_before is NULL → treated as 0).
WITH ordered AS (
  SELECT
    id,
    amount,
    SUM(amount) OVER (
      PARTITION BY user_id
      ORDER BY created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS running_before
  FROM coin_transactions
),
computed AS (
  SELECT
    id,
    COALESCE(running_before, 0) AS balance_before,
    COALESCE(running_before, 0) + amount AS balance_after
  FROM ordered
)
UPDATE coin_transactions ct
SET
  balance_before = c.balance_before,
  balance_after  = c.balance_after
FROM computed c
WHERE ct.id = c.id;--> statement-breakpoint
-- Partial unique index: one signup_bonus per user, enforced at DB level
CREATE UNIQUE INDEX "coin_transactions_signup_bonus_per_user_idx" ON "coin_transactions" ("user_id") WHERE type = 'signup_bonus';