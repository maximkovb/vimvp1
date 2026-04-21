---
title: Poll TikTok analytics every 10 min and auto-resolve on milestone
type: feat
status: active
date: 2026-04-02
origin: docs/brainstorms/2026-04-02-analytics-polling-requirements.md
---

# feat: Poll TikTok Analytics Every 10 Min and Auto-Resolve on Milestone

## Overview

TikTok market stats (view count, like count) are only fetched at market creation and never updated. This adds continuous 10-minute polling for all active/halted markets, and auto-resolves a market immediately when a poll detects the milestone threshold has been crossed — rather than waiting for the scheduled `resolvesAt` deadline.

## Problem Statement / Motivation

- The view/like trajectory chart on the market detail page is stale from the moment a market opens.
- Markets never resolve early even when the outcome is obvious (e.g., 10M views hit on day 1 of a 30-day market), creating a poor user experience and incorrect odds.
- Polling currently runs every 15 minutes; the product requirement is 10 minutes.

*(see origin: docs/brainstorms/2026-04-02-analytics-polling-requirements.md)*

## Proposed Solution

Two coordinated changes:

1. **Reduce polling interval** — change the Vercel cron schedule and the in-process `shouldPoll` guard from 15 minutes to 10 minutes.
2. **Auto-resolve on milestone** — inside the per-market poll loop, after inserting a new poll row, check if the fetched metric meets or exceeds `milestoneThreshold`. If so: transition the market to `"resolving"` (guarded by a conditional WHERE), then call `resolveMarket()` inline to complete resolution in the same cron run.

The existing `resolve-markets` cron (every 5 min) continues to handle time-based resolution; this change is purely additive.

## Technical Considerations

- **`resolveMarket()` requires `"resolving"` status** (`src/lib/oracle.ts:52`). The poll cron must set the market to `"resolving"` before calling it.
- **Idempotency is built-in.** The `db.update` to `"resolving"` uses a `WHERE status IN ('active', 'halted')` guard, so a concurrent `resolve-markets` run cannot double-transition. The oracle's transaction also guards on `status = "resolving"`, so `resolveMarket()` called twice is a no-op on the second call.
- **BigInt comparison.** `milestoneThreshold` is `bigint` in the DB (schema.ts:98). `stats.viewCount` / `stats.likeCount` come back as JS `number` from `fetchTikTokStatsById` (tiktok.ts). Must wrap with `BigInt()` before comparing — same pattern as the existing insert at poll-tiktok/route.ts:71.
- **Error isolation.** Auto-resolve failure (oracle throws) must be caught separately so it does not skip `polledCount++` or abort the loop. Add a `resolveErrors: string[]` alongside the existing `errors` array for observability.
- **Null stats (deleted/private video).** When `stats === null`, the poll inserts null counts and auto-resolution must not trigger. Gate the check on `stats !== null`.
- **Rate limiting.** The existing 1.1s sleep between requests stays in place. At 10-minute intervals the rate-limit risk is unchanged.

## Files to Change

| File | Change |
|------|--------|
| `vercel.json:5` | `"*/15 * * * *"` → `"*/10 * * * *"` |
| `src/app/api/cron/poll-tiktok/route.ts:22` | `15 * 60 * 1000` → `10 * 60 * 1000` |
| `src/app/api/cron/poll-tiktok/route.ts` (poll loop) | Add post-insert milestone check + inline `resolveMarket()` call |

No schema migrations needed — no new tables or columns.

## Implementation Detail

Inside the per-market try/catch in `poll-tiktok/route.ts`, after the `tiktokPolls` insert and thumbnail update, add:

```typescript
// Auto-resolve if milestone crossed
if (stats !== null) {
  const metric =
    market.questionType === "views"
      ? BigInt(stats.viewCount)
      : BigInt(stats.likeCount);

  if (metric >= market.milestoneThreshold) {
    try {
      // Only proceed if status transition succeeded (guards against already-resolved markets)
      const transitioned = await db
        .update(markets)
        .set({ status: "resolving" })
        .where(
          and(
            eq(markets.id, market.id),
            or(eq(markets.status, "active"), eq(markets.status, "halted"))
          )
        )
        .returning({ id: markets.id });

      if (transitioned.length > 0) {
        await resolveMarket(market.id);
        earlyResolvedCount++;
      }
    } catch (resolveErr) {
      const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      console.error(`Early resolve failed for market ${market.id}:`, msg);
      resolveErrors.push(`${market.id}: ${msg}`);
    }
  }
}
```

Return `earlyResolved` and `resolveErrors` in the JSON response alongside `polled` and `errors` for observability.

## System-Wide Impact

- **Interaction graph:** Poll cron inserts `tiktokPolls` row → checks threshold → updates `markets.status` → calls `resolveMarket()` → DB transaction updates `markets` (status/outcome/resolvedAt) + calls `distributePayout()` → inserts `coinTransactions` rows. Same chain as the time-based path, just triggered earlier.
- **Error propagation:** A `resolveMarket()` failure leaves the market in `"resolving"` status. The `resolve-markets` cron (every 5 min) will pick it up and retry — same recovery path as a time-based failure. No orphaned state risk.
- **State lifecycle risks:** The `WHERE status IN ('active', 'halted')` guard on the status transition prevents double-transitioning. A market that is already `"resolving"` or `"resolved"` when the poll fires will silently skip the auto-resolve block — the `.returning()` check ensures `resolveMarket()` is only called when the transition actually succeeded (i.e., updated exactly 1 row).
- **API surface parity:** No new public API endpoints. The cron response JSON gains two new fields (`earlyResolved`, `resolveErrors`) but is only consumed by Vercel's internal cron runner.
- **Integration test scenarios:**
  1. Active market + metric crosses threshold on poll → market resolves within same cron run, payouts distributed.
  2. Halted market + milestone crossed → still auto-resolves (halted markets are polled).
  3. Stats return `null` (deleted video) → no resolution triggered, null counts inserted as normal.
  4. Concurrent `poll-tiktok` + `resolve-markets` both fire near `resolvesAt` → both guards prevent double-resolution.
  5. `resolveMarket()` throws (e.g., no poll data race) → market stays `"resolving"`, `resolve-markets` retries within 5 min, poll loop continues.

## Acceptance Criteria

- [ ] The Vercel cron for `poll-tiktok` runs at `*/10 * * * *` (10-minute schedule).
- [ ] `shouldPoll()` uses a 10-minute threshold (`10 * 60 * 1000`).
- [ ] A market's view/like trajectory chart shows a new data point at most 10 minutes after the previous one while the market is active or halted.
- [ ] When a poll detects `viewCount` or `likeCount >= milestoneThreshold`, the market transitions to `"resolved"` with correct outcome and payouts distributed — within the same cron run.
- [ ] `stats === null` (deleted/private video) does not trigger auto-resolution.
- [ ] A market already in `"resolving"` or `"resolved"` status when a poll fires is unaffected (no double-resolution, no errors).
- [ ] Auto-resolve failure is captured in the cron response JSON and logged, but does not abort polling for other markets.
- [ ] Markets that never hit the milestone still resolve at `resolvesAt` via the existing `resolve-markets` cron (no regression).

## Success Metrics

- Trajectory charts update visibly within 10 minutes of a market opening.
- At least one market resolves early in staging when a test video is manually pushed past threshold.
- No increase in cron error rate or `"failed"` market count post-deploy.

## Dependencies & Risks

- **Vercel cron minimum interval:** Vercel Pro supports 1-minute cron intervals; `*/10` is well within limits.
- **TikAPI rate limit:** The 1.1s sleep gives ~54 markets max per cron run. If active market count grows beyond ~50, the cron will exceed its 60-second `maxDuration`. Risk is low for MVP scale; monitor and split into batched runs if needed.
- **`resolveMarket()` assumes a poll row exists.** It fetches `ORDER BY polledAt DESC LIMIT 1`. Since we just inserted a poll row before calling it, this is always satisfied.

## Outstanding Questions Carried from Brainstorm

*(From origin document — intentionally deferred to planning)*

- **Direct call vs. delegate:** Resolved as **direct call** — `resolveMarket()` is called inline in the poll cron for true immediate resolution. The 5-min lag of delegating to `resolve-markets` is unacceptable given the feature intent.
- **Rate limit headroom at 10-minute interval:** Unchanged risk vs. 15-minute interval for current market counts. Document in runbook to watch `polled` vs. `skipped` ratio in cron logs.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-02-analytics-polling-requirements.md](../brainstorms/2026-04-02-analytics-polling-requirements.md)
  Key decisions carried forward: immediate resolution on threshold crossed; TikTok-only scope; 10-minute interval.
- `src/app/api/cron/poll-tiktok/route.ts:15-23` — `shouldPoll()` guard
- `src/app/api/cron/poll-tiktok/route.ts:64-98` — per-market poll loop and error isolation pattern
- `src/app/api/cron/resolve-markets/route.ts:27-57` — existing status transition + `resolveMarket()` call pattern
- `src/lib/oracle.ts:47-55` — `resolveMarket()` idempotency via `WHERE status = "resolving"` guard
- `src/lib/services/payout.ts:23-33` — payout idempotency via `coinTransactions` check
- `src/db/schema.ts:78-85,89-125,213-226` — `MarketStatus`, `markets`, `tiktokPolls`
- `vercel.json:4-11` — current cron schedules
