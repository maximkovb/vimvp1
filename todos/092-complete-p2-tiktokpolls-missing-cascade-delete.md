---
status: pending
priority: p2
issue_id: "092"
tags: [code-review, database, tiktok, migration]
dependencies: ["084"]
---

# tiktokPolls Foreign Key Missing ON DELETE CASCADE

## Problem Statement

The `tiktokPolls` table's `marketId` foreign key has no `ON DELETE CASCADE`. If a market is ever hard-deleted, the delete will fail with a foreign key constraint violation unless poll rows are manually removed first. This is a latent issue — the same exists in `youtubePolls` — but should be fixed in the new migration while it's being written.

## Findings

From `src/db/schema.ts`:
```ts
marketId: text("market_id").notNull().references(() => markets.id),
// ↑ no { onDelete: "cascade" }
```

Compare with `accounts` table:
```ts
userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
```

The schema-drift-detector confirmed both `tiktokPolls` and `youtubePolls` share this omission, and it is consistent with the existing pattern — but worth fixing.

## Proposed Solutions

### Option A: Add CASCADE to Schema Definition + Migration
In `src/db/schema.ts`:
```ts
marketId: text("market_id").notNull().references(() => markets.id, { onDelete: "cascade" }),
```

And in the migration SQL:
```sql
ALTER TABLE "tiktok_polls" DROP CONSTRAINT "tiktok_polls_market_id_markets_id_fk";
ALTER TABLE "tiktok_polls" ADD CONSTRAINT "tiktok_polls_market_id_markets_id_fk"
  FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE CASCADE;
```

**Pros:** Future-proof; allows market cleanup without manual poll deletion
**Effort:** Small
**Risk:** Low — only affects DELETE operations (which aren't currently used)

### Option B: Fix Only tiktokPolls (Leave youtubePolls as-is)
Fix `tiktokPolls` in the new migration while leaving `youtubePolls` for a separate migration.

**Pros:** Smaller change surface
**Cons:** Inconsistent between the two tables
**Effort:** Trivial

### Option C: Fix Both tiktokPolls and youtubePolls in This Migration
Modify both FK constraints to add `ON DELETE CASCADE` in the same migration.

**Pros:** Consistent; cleans up the existing gap
**Effort:** Small
**Risk:** Low

## Recommended Action

Option C — fix both in the same migration since you're already writing it. The schema change is in `src/db/schema.ts` (both tables) and the migration adds the CASCADE constraints.

## Technical Details

- **Affected files:** `src/db/schema.ts` (tiktokPolls + youtubePolls), new migration
- **Dependency:** Should be done as part of todo #084 migration work

## Acceptance Criteria

- [ ] `tiktokPolls.marketId` has `{ onDelete: "cascade" }` in schema definition
- [ ] `youtubePolls.marketId` has `{ onDelete: "cascade" }` in schema definition
- [ ] Migration adds CASCADE to both FK constraints
- [ ] Hard-deleting a market cascades to poll rows without error

## Work Log

- 2026-03-29: Identified by schema-drift-detector agent during TikTok integration code review
