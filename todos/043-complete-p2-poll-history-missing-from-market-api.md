---
status: complete
priority: p2
issue_id: "043"
tags: [code-review, agent-native, api]
dependencies: ["036"]
---

# Video Stats Trajectory (Poll History) Missing from `GET /api/markets/[id]`

## Problem Statement

The market detail page renders a view/like count trajectory chart using `youtubePolls` data. The `GET /api/markets/[id]` API endpoint returns `priceHistory` and `trades` but not `pollHistory`. An agent reading the market API sees the price history but has no access to the primary signal a human uses to evaluate a YES/NO prediction — whether the video is tracking toward its milestone. This is a significant context parity gap.

## Findings

- `src/app/markets/[id]/page.tsx` queries `youtubePolls` and renders `VideoStatsChart`
- `src/app/api/markets/[id]/route.ts` includes `priceHistory` but not `pollHistory`
- Agent-native reviewer rated this as critical for agent parity
- The `youtubePolls` table is already fully queryable; adding this requires one parallel query

## Proposed Solutions

### Solution A: Add `pollHistory` to the API response (Recommended)
```ts
// In src/app/api/markets/[id]/route.ts:
const pollHistory = await db
  .select({
    time: youtubePolls.polledAt,
    viewCount: youtubePolls.viewCount,
    likeCount: youtubePolls.likeCount,
  })
  .from(youtubePolls)
  .where(eq(youtubePolls.marketId, id))
  .orderBy(youtubePolls.polledAt)
  .limit(500);

// In the JSON response:
pollHistory: pollHistory.map((p) => ({
  time: p.time.toISOString(),
  viewCount: p.viewCount !== null ? Number(p.viewCount) : null,
  likeCount: p.likeCount !== null ? Number(p.likeCount) : null,
})),
```
Note: `viewCount`/`likeCount` are BigInt — must convert with `Number()` before JSON serialization.
- **Pros**: Full parity with what the UI shows; agents can evaluate trajectory
- **Cons**: Slightly larger API response; additional DB query per request
- **Effort**: Small
- **Risk**: Low — additive change

### Solution B: Add a separate `GET /api/markets/[id]/polls` endpoint
Keep the existing route unchanged, add a sub-route.
- **Pros**: Doesn't change existing API contract
- **Cons**: Agents must make two requests to evaluate a market; unnecessary complexity
- **Effort**: Medium
- **Risk**: Low

## Recommended Action

Solution A. Bundle into the existing market API route. The BigInt → Number conversion is the main gotcha (same pattern already used in `page.tsx`).

## Technical Details

- **Affected files**: `src/app/api/markets/[id]/route.ts`
- **BigInt caveat**: `viewCount` and `likeCount` are Drizzle `bigint` columns — `JSON.stringify` will throw on raw BigInt. Use `Number()`.

## Acceptance Criteria

- [ ] `GET /api/markets/[id]` response includes a `pollHistory` array
- [ ] Each entry has `time` (ISO string), `viewCount` (number or null), `likeCount` (number or null)
- [ ] BigInt values are correctly converted to numbers (not raw BigInt, which breaks JSON)
- [ ] Market with no poll history returns `pollHistory: []`

## Work Log

- 2026-03-23: Identified by agent-native-reviewer during code review of feat/video-intelligence-panel
