---
status: pending
priority: p1
issue_id: "084"
tags: [code-review, database, migration, tiktok]
dependencies: []
---

# Migration: Column Rename May Generate DROP+ADD (Data Loss Risk)

## Problem Statement

Drizzle ORM does not always detect column renames. When `drizzle-kit generate` runs for the `youtubeVideoId → videoId` rename, it may emit:

```sql
ALTER TABLE "markets" DROP COLUMN "youtube_video_id";
ALTER TABLE "markets" ADD COLUMN "video_id" text NOT NULL;
```

Instead of:

```sql
ALTER TABLE "markets" RENAME COLUMN "youtube_video_id" TO "video_id";
```

The DROP+ADD path **destroys all existing videoId data for every market in production**.

## Findings

- `src/db/schema.ts` renames `youtubeVideoId` → `videoId` in the Drizzle table definition
- The existing baseline migration `drizzle/0000_fancy_payback.sql:27` still has `"youtube_video_id" text NOT NULL`
- Drizzle's rename detection is interactive only — it prompts during `drizzle-kit generate` with "Is this a rename?"
- If the migration is generated non-interactively (CI, scripts) or if the user presses the wrong option, the result is a destructive DROP+ADD
- The `schema-drift-detector` agent confirmed source files are clean (no old references), but flagged this as the single highest-risk item

## Proposed Solutions

### Option A: Inspect and Manually Edit the Generated Migration (Recommended)
1. Run `npx drizzle-kit generate` interactively
2. When prompted about `youtube_video_id`, select "rename" (not "drop+add")
3. After generation, open the `.sql` file and verify it contains `RENAME COLUMN` — not `DROP COLUMN`
4. If Drizzle still generated DROP+ADD, manually edit the SQL to use `RENAME COLUMN` before applying

**Pros:** Correct semantic, zero data loss
**Cons:** Requires human inspection step; easy to forget
**Effort:** Small
**Risk:** Low if verified

### Option B: Write the Migration Manually
Skip `drizzle-kit generate` for this migration. Write the SQL by hand:
```sql
ALTER TABLE "markets" RENAME COLUMN "youtube_video_id" TO "video_id";
CREATE TYPE "public"."platform" AS ENUM ('youtube', 'tiktok', 'instagram');
ALTER TABLE "markets" ADD COLUMN "platform" "platform" DEFAULT 'youtube' NOT NULL;
ALTER TABLE "markets" ADD COLUMN "tikapi_post_id" text;
CREATE TABLE "tiktok_polls" (...);
```

**Pros:** Full control, no surprise
**Cons:** Must keep in sync with schema definition; can diverge
**Effort:** Medium
**Risk:** Low

### Option C: Add a Drizzle Custom Migration
Use `drizzle-kit generate` for the non-rename parts, then create a separate custom migration file for the rename, applied first.

**Pros:** Best of both worlds
**Cons:** More files to track
**Effort:** Medium

## Recommended Action

Option A — run interactively, inspect the generated SQL, verify `RENAME COLUMN` before applying. Document this as a team runbook step.

## Technical Details

- **Affected files:** `drizzle/0000_fancy_payback.sql` (baseline), new generated migration
- **Column:** `markets.youtube_video_id` → `markets.video_id`
- **Risk:** Complete loss of all market videoId values in production

## Acceptance Criteria

- [ ] Generated migration contains `RENAME COLUMN "youtube_video_id" TO "video_id"` (not DROP+ADD)
- [ ] Generated migration includes `CREATE TYPE "public"."platform" AS ENUM (...)` before any `ADD COLUMN` using it
- [ ] Generated migration includes `DEFAULT 'youtube'` on the platform `ADD COLUMN` statement
- [ ] Migration applied to staging/preview environment successfully without data loss
- [ ] All existing markets retain their videoId values after migration

## Work Log

- 2026-03-29: Identified by schema-drift-detector agent during TikTok integration code review
