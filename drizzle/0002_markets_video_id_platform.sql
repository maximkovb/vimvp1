CREATE TYPE "public"."platform" AS ENUM('youtube', 'tiktok', 'instagram');--> statement-breakpoint
ALTER TABLE "markets" RENAME COLUMN "youtube_video_id" TO "video_id";--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "platform" "platform" DEFAULT 'youtube' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "tikapi_post_id" text;
