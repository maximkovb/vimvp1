---
status: pending
priority: p1
issue_id: "086"
tags: [code-review, performance, tiktok, cron, vercel]
dependencies: []
---

# poll-tiktok Cron: Sequential 1100ms Sleep Causes Vercel Timeout

## Problem Statement

The `poll-tiktok` cron processes markets sequentially with a 1100ms sleep between each API call to respect TikAPI's 60 req/min rate limit. At ~15 active TikTok markets, the total runtime (~16.5s) exceeds Vercel's 10-second default serverless function timeout. At 50 markets it would take 55 seconds — far beyond any timeout tier.

The cron will silently fail (Vercel returns 504) for any deployment with more than 9 active TikTok markets.

## Findings

From `src/app/api/cron/poll-tiktok/route.ts`:

```ts
for (const market of activeMarkets) {
  // fetch + db update
  await new Promise((resolve) => setTimeout(resolve, 1100)); // ← 1.1s per market
}
```

- Vercel hobby/pro default function timeout: 10s (configurable up to 60s on pro, 300s on enterprise)
- 1100ms × 9 markets = 9.9s → passes; 10 markets → fails
- The cron entry is also missing from `vercel.json` entirely (see todo #087), so it doesn't run at all yet — but must be fixed before registration

## Proposed Solutions

### Option A: Add `maxDuration` Export + Batch with Promise.all (Recommended)
Set the route's `maxDuration` to 60 seconds (Vercel Pro) and batch markets 5 at a time with inter-batch delay:

```ts
export const maxDuration = 60; // seconds

const BATCH_SIZE = 5;
for (let i = 0; i < activeMarkets.length; i += BATCH_SIZE) {
  const batch = activeMarkets.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(pollMarket));
  if (i + BATCH_SIZE < activeMarkets.length) {
    await new Promise(r => setTimeout(r, 1200)); // 1.2s between batches = ~4.2 req/s < 60/min
  }
}
```

**Pros:** 5× throughput; stays under rate limit (5 parallel × ~1s = 5 req/s < 60/min)
**Cons:** Requires Pro plan for 60s timeout
**Effort:** Small
**Risk:** Low

### Option B: Add `maxDuration` Only (Quick Fix)
Just export `maxDuration = 60` — this alone extends the timeout for most current use cases without changing the sequential logic.

```ts
export const maxDuration = 60;
```

**Pros:** One-line change, immediate fix for up to ~54 markets
**Cons:** Still O(n) sequential; doesn't scale past 54 markets
**Effort:** Trivial
**Risk:** None

### Option C: Fan-Out to Queue (Long-term)
For each active market, enqueue a job. Worker processes jobs with rate limiting. Requires Vercel Queue or external queue (Upstash QStash).

**Pros:** Scales to any number of markets
**Cons:** Significant infrastructure change
**Effort:** Large

## Recommended Action

Option B as immediate fix (one line), Option A as the proper solution to implement alongside. Both are needed before deploying with any active TikTok markets.

## Technical Details

- **Affected file:** `src/app/api/cron/poll-tiktok/route.ts`
- **Add:** `export const maxDuration = 60;` at top of file
- **Also:** Consider batching to 5 parallel with 1200ms inter-batch delay

## Acceptance Criteria

- [ ] `export const maxDuration = 60` added to route file
- [ ] Cron completes within maxDuration for up to 50 active markets
- [ ] Rate limit of 60 req/min not exceeded under any batch configuration
- [ ] Timeout behavior documented in AGENTS.md or code comment

## Work Log

- 2026-03-29: Identified by performance-oracle agent during TikTok integration code review
