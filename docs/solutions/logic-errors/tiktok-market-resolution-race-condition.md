---
title: "TikTok Market Polling Interval Fix and Early Auto-Resolution with Race Condition Guard"
category: logic-errors
date: 2026-04-02
tags:
  - cron
  - polling
  - auto-resolution
  - race-condition
  - market-lifecycle
  - tiktok
  - drizzle-orm
  - postgres
  - vercel
  - state-machine
components:
  - vercel.json
  - src/app/api/cron/poll-tiktok/route.ts
  - src/lib/oracle.ts
problem_type: logic-errors
severity: high
---

# TikTok Market Polling Interval Fix and Early Auto-Resolution with Race Condition Guard

## Problem Description

Three issues were addressed in the TikTok prediction market cron pipeline:

1. **Stale analytics**: TikTok view/like stats never updated after market creation. The 15-minute polling interval was too slow and was inconsistently configured across two places.
2. **Missing early auto-resolution**: Markets only resolved at their `resolvesAt` deadline. When a video surpassed the milestone threshold (views or likes ≥ `milestoneThreshold`) before the deadline, the market sat open indefinitely.
3. **Trade race condition (discovered during implementation)**: The naive fix for issue 2 — transitioning directly from `active → resolving` — bypasses the halt mechanism that closes trading before resolution. Under Postgres READ COMMITTED, a trade can slip through during that window.

## Root Cause Analysis

**Dual-location polling config**: Both `vercel.json` (cron schedule) and the `shouldPoll` guard inside `poll-tiktok/route.ts` independently specify the interval. Only updating one causes either unnecessary API calls or silent poll skipping. These are two independently written constants that must always match.

**No milestone check in poll loop**: The polling loop fetched fresh stats and stored them but never compared the new counts against `milestoneThreshold`. Early resolution was never triggered.

**Skip-the-halt bug**: The market state machine's halt step (`active → halted`) exists to close the trade window before resolution begins. Trades check `WHERE status = 'active'` — once `halted`, they are rejected. Skipping directly to `resolving` leaves a window where a concurrent trade can read `status = 'active'`, pass the guard, and commit against a market that is simultaneously being resolved. Postgres `READ COMMITTED` does not prevent this.

## Investigation / What Was Tried

- Confirmed `vercel.json` had `"schedule": "*/15 * * * *"` and the `shouldPoll` guard used `15 * 60 * 1000` — both needed updating.
- Confirmed `resolveMarket()` in `src/lib/oracle.ts` has a `WHERE status = 'resolving'` guard, making it idempotent — safe to call from any trigger.
- Identified that `milestoneThreshold` is `bigint` in the DB while `stats.viewCount`/`likeCount` are JS `number` — direct comparison would fail silently at runtime.
- Recognized that the existing deadline resolution path always follows `active → halted → resolving` and that mirroring this in the early-resolution path closes the race window without adding any meaningful delay.

## Working Solution

### 1. Vercel cron schedule — `vercel.json`

```json
{
  "path": "/api/cron/poll-tiktok",
  "schedule": "*/10 * * * *"
}
```

### 2. In-process guard — `shouldPoll` in `poll-tiktok/route.ts`

```typescript
// Both the schedule above and this guard must always match
return Date.now() - lastPollAt.getTime() >= 10 * 60 * 1000;
```

### 3. Early auto-resolution block — inserted after poll data is stored

```typescript
// Auto-resolve if milestone crossed
if (stats !== null) {
  const metric =
    market.questionType === "views"
      ? BigInt(stats.viewCount)
      : BigInt(stats.likeCount);

  if (metric >= market.milestoneThreshold) {
    try {
      // Step 1: Halt trading first (active → halted) to close the trade window.
      // No-op if the market is already halted.
      await db
        .update(markets)
        .set({ status: "halted" })
        .where(and(eq(markets.id, market.id), eq(markets.status, "active")));

      // Step 2: Transition to resolving. Guarded with .returning() — only
      // proceeds if market is currently halted. Guards against double-resolution.
      const transitioned = await db
        .update(markets)
        .set({ status: "resolving" })
        .where(and(eq(markets.id, market.id), eq(markets.status, "halted")))
        .returning({ id: markets.id });

      // Step 3: Only call resolveMarket if we won the transition.
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

## Key Implementation Notes

**BigInt conversion is mandatory.** `milestoneThreshold` is a `bigint` column; `stats.viewCount` and `stats.likeCount` are JS `number`. Direct comparison throws a `TypeError`. Always wrap with `BigInt()` before comparing, matching the existing insert pattern at `poll-tiktok/route.ts:71`.

**The halt step is not ceremonial — it is the trade lock.** Once `status = 'halted'`, all trade entry points that check `WHERE status = 'active'` are already blocked before the `resolving` transition begins. The two steps happen sequentially in the same cron run (no delay added), but the race window is eliminated.

**`.returning()` as the distributed lock gate.** The `halted → resolving` transition uses `.returning({ id: markets.id })`. If another cron run already transitioned the market, the `WHERE status = 'halted'` clause matches 0 rows, `resolveMarket()` is never called, and `earlyResolvedCount` is not incremented. This prevents double-resolution without a separate SELECT.

**Failure recovery via resolve-markets cron.** If `resolveMarket()` throws after the market has already been set to `resolving`, the market stays in that status. The `resolve-markets` cron (running every 5 minutes) picks up any market in `resolving` status and retries — serving as automatic recovery. The error is captured in `resolveErrors[]` and logged but does not abort the poll loop for other markets.

**`shouldPoll` and the cron schedule must always match.** The guard prevents redundant API calls if Vercel fires more frequently than expected. Changing one without the other causes silent poll skipping (if guard is more restrictive) or unnecessary TikTok API calls (if schedule is more restrictive).

## The Skip-the-Halt Bug Pattern

**How to recognize it:** A single `UPDATE markets SET status = 'resolving' WHERE id = $1 AND status = 'active'`. Looks safe due to the `WHERE` guard, but under `READ COMMITTED`, a concurrent trade transaction can read `status = 'active'` and begin before this update commits.

**Grep for it:**
```
SET status = 'resolving'.*AND.*status = 'active'
WHERE.*status.*active.*resolving
```

Any query that writes `resolving` while filtering on `active` in the same statement is the bug.

**Correct pattern:**
```typescript
// Step 1 — idempotent halt (red light)
await db.update(markets).set({ status: 'halted' }).where(
  and(eq(markets.id, id), eq(markets.status, 'active'))
);

// Step 2 — distributed lock via .returning() (who wins enters the intersection)
const [won] = await db.update(markets).set({ status: 'resolving' }).where(
  and(eq(markets.id, id), eq(markets.status, 'halted'))
).returning({ id: markets.id });

if (!won) return; // another runner won

// Step 3 — only the winner executes
await resolveMarket(id);
```

## Prevention Strategies

**Resolution trigger checklist** — for any new resolution trigger added in future:

- [ ] Follows `active → halted → resolving` — never `active → resolving` directly
- [ ] Halt step uses `WHERE status = 'active'` (idempotent no-op on already-halted)
- [ ] `halted → resolving` uses `.returning()` and only proceeds if a row was returned
- [ ] If an interval is configured in two places (schedule + guard), both reference the same constant
- [ ] Failure path leaves the market in `resolving` (so the recovery cron can retry), not `failed`

**Interval drift test** (add to CI):
Parse the Vercel cron schedule string and assert it equals the `shouldPoll` threshold constant converted to minutes. Prevents silent drift when one is updated without the other.

**Monitoring:**
- Alert if any market is in `resolving` status for more than 2 minutes (resolution is near-instantaneous normally)
- Alert if any market reaches `deadline + 10 minutes` without reaching `resolved`
- Track `milestone_hit_at → resolved_at` lag; should be less than one poll interval

## Related Documents

### Origin & Planning
- [Brainstorm: Analytics Polling & Auto-Resolution requirements](../../brainstorms/2026-04-02-analytics-polling-requirements.md)
- [Plan: Poll TikTok every 10 min and auto-resolve on milestone](../../plans/2026-04-02-002-feat-tiktok-polling-auto-resolve-plan.md)

### Foundational Infrastructure This Solution Builds On
- [Plan: Oracle Library + Live Market Page SWR Refresh](../../plans/2026-03-28-001-feat-oracle-library-live-market-refresh-plan.md) — created `resolveMarket()` and its idempotency contract
- [Plan: Market Creation & Cron Cleanup](../../plans/2026-03-31-002-fix-market-creation-and-cron-cleanup-plan.md) — established the 15-min baseline this solution supersedes
- [Plan: Replace TikAPI with TikWM](../../plans/2026-03-30-001-feat-replace-tikapi-with-tikwm-plan.md) — source of `fetchTikTokStatsById` return contract (JS `number`), explains BigInt wrapping requirement

### Patterns Applied
- [Solution: Next.js Financial App Code Review Patterns](../database-issues/nextjs-financial-app-code-review-patterns.md) — Pattern 5 (cron state machine idempotency), Pattern 9 (composite index on polling hot path)

### Historical Precedent (YouTube Era)
- [Brainstorm: Poll Frequency — View Trajectory Freshness](../../brainstorms/2026-03-29-poll-frequency-view-trajectory-requirements.md) — established the ≤10-min staleness standard now applied to TikTok
