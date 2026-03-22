ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
CREATE INDEX "youtube_polls_market_polled_idx" ON "youtube_polls" USING btree ("market_id","polled_at");