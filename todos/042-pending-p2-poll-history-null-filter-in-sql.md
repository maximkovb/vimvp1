---
status: complete
priority: p2
issue_id: "042"
tags: [code-review, performance, database]
dependencies: ["036"]
---

# Poll History Null Filter Applied in JS After Full 500-Row Fetch

## Problem Statement

`page.tsx` fetches up to 500 rows from `youtubePolls` and then applies a `.filter()` in JavaScript to exclude rows where the relevant count (`viewCount` or `likeCount`) is null. This means Neon sends the full 500 rows across the wire (including rows with null values) only for half or more to be discarded in application code. On Neon serverless Postgres, data transfer is billed and the single connection is occupied longer than needed.

## Findings

- `src/app/markets/[id]/page.tsx` lines 61-76: query fetches all rows, then JS filters out nulls
- A market with `questionType === "views"` discards all rows where `viewCount IS NULL`
- The filter condition is fully expressible in SQL and Drizzle supports it
- Performance oracle identified this as a critical waste of network transfer and connection time
- Depends on todo 036 (index) for full performance benefit

## Proposed Solutions

### Solution A: Push the null filter into the Drizzle query (Recommended)
```ts
import { and, eq, isNotNull } from "drizzle-orm";

const pollHistory = await db
  .select()
  .from(youtubePolls)
  .where(
    and(
      eq(youtubePolls.marketId, id),
      market.questionType === "views"
        ? isNotNull(youtubePolls.viewCount)
        : isNotNull(youtubePolls.likeCount)
    )
  )
  .orderBy(youtubePolls.polledAt)
  .limit(500);
```
Then the `.map()` can drop the `!` non-null assertions entirely since the DB guarantees the column is not null.
- **Pros**: Less data over the wire, simpler JS, removes non-null assertions, query intent is explicit
- **Cons**: Slightly more complex Drizzle call
- **Effort**: Small
- **Risk**: Low — semantically identical behavior

### Solution B: Keep as-is
- **Pros**: No change
- **Cons**: Unnecessary data transfer on every page render; compounds with todo 036 inefficiency
- **Effort**: None
- **Risk**: Performance degradation at scale

## Recommended Action

Solution A. Bundle with the fix for todo 037 (non-null assertions) since both changes affect the same lines in `page.tsx`.

## Technical Details

- **Affected files**: `src/app/markets/[id]/page.tsx`
- **Imports needed**: `and`, `isNotNull` from `drizzle-orm`

## Acceptance Criteria

- [ ] Drizzle query includes `isNotNull(youtubePolls.viewCount)` or `isNotNull(youtubePolls.likeCount)` based on `market.questionType`
- [ ] `.filter()` step is removed from `statsChartData` construction
- [ ] Non-null assertions (`!`) on `p.viewCount` and `p.likeCount` are removed
- [ ] Market detail page renders correct chart data for both `views` and `likes` question types

## Work Log

- 2026-03-23: Identified by performance-oracle and kieran-typescript-reviewer during code review of feat/video-intelligence-panel
