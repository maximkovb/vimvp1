CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "coin_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"type" text NOT NULL,
	"reference_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"youtube_video_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"question_type" text NOT NULL,
	"milestone_threshold" bigint NOT NULL,
	"b_parameter" numeric(10, 2) DEFAULT '100' NOT NULL,
	"quantity_yes" numeric(16, 6) DEFAULT '0' NOT NULL,
	"quantity_no" numeric(16, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"outcome" integer,
	"video_metadata" jsonb,
	"opens_at" timestamp,
	"halts_at" timestamp,
	"resolves_at" timestamp,
	"resolved_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"market_id" text NOT NULL,
	"outcome" integer NOT NULL,
	"shares" numeric(16, 6) DEFAULT '0' NOT NULL,
	"avg_cost_basis" numeric(12, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"price_yes" numeric(8, 6) NOT NULL,
	"price_no" numeric(8, 6) NOT NULL,
	"volume_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"market_id" text NOT NULL,
	"outcome" integer NOT NULL,
	"shares" numeric(16, 6) NOT NULL,
	"cost" numeric(12, 6) NOT NULL,
	"price_before" numeric(8, 6) NOT NULL,
	"price_after" numeric(8, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"password_hash" text,
	"image" text,
	"balance" numeric(12, 2) DEFAULT '1000' NOT NULL,
	"login_streak" integer DEFAULT 0 NOT NULL,
	"last_login_reward" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_polls" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"polled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_polls" ADD CONSTRAINT "youtube_polls_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_transactions_user_id_idx" ON "coin_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "coin_transactions_type_idx" ON "coin_transactions" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_transactions_user_ref_type_idx" ON "coin_transactions" USING btree ("user_id","reference_id","type");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "markets_resolves_at_idx" ON "markets" USING btree ("resolves_at");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_user_market_outcome_idx" ON "positions" USING btree ("user_id","market_id","outcome");--> statement-breakpoint
CREATE INDEX "positions_user_id_idx" ON "positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_market_id_idx" ON "positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_market_id_idx" ON "price_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_recorded_at_idx" ON "price_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "trades_user_id_idx" ON "trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_market_id_idx" ON "trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "trades_created_at_idx" ON "trades" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_identifier_token_idx" ON "verification_tokens" USING btree ("identifier","token");--> statement-breakpoint
CREATE INDEX "youtube_polls_market_id_idx" ON "youtube_polls" USING btree ("market_id");