CREATE TABLE "tiktok_polls" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"polled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "youtube_polls" CASCADE;--> statement-breakpoint
ALTER TABLE "tiktok_polls" ADD CONSTRAINT "tiktok_polls_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tiktok_polls_market_id_idx" ON "tiktok_polls" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "tiktok_polls_market_polled_idx" ON "tiktok_polls" USING btree ("market_id","polled_at");--> statement-breakpoint
ALTER TABLE "markets" DROP COLUMN "platform";--> statement-breakpoint
DROP TYPE "public"."platform";