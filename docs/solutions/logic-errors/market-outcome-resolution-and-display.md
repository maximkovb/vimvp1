---
title: "Market Oracle Resolves Wrong Outcome + YES/NO Labels Inverted in UI"
category: logic-errors
date: 2026-04-16
tags:
  - oracle
  - market-resolution
  - race-condition
  - outcome-display
  - drizzle-orm
  - tiktok-polls
  - prediction-market
  - integer-encoding
components:
  - src/lib/oracle.ts
  - src/app/portfolio/page.tsx
  - src/app/history/page.tsx
  - src/components/MarketCard.tsx
  - src/components/MarketLiveData.tsx
problem_type: logic-errors
severity: high
---

# Market Oracle Resolves Wrong Outcome + YES/NO Labels Inverted in UI

## Symptoms

- A market whose video crossed the milestone threshold auto-resolved as **NO** instead of YES
- In the portfolio page, a user who bet **YES** appeared to have bet NO
- Resolved market cards showed the wrong outcome label with inverted color (green for NO, red for YES)
- Trade history and live trades feed displayed YES/NO labels backwards

## Root Cause Analysis

Two independent bugs with a compounding effect: the oracle stored the wrong resolution outcome, and the UI then displayed that stored value backwards.

### Bug 1 — Oracle: Latest-poll-only resolution (race condition)

`resolveMarket()` in `src/lib/oracle.ts` determined YES/NO by reading the **most recent** poll row (`ORDER BY polledAt DESC LIMIT 1`) and comparing its metric to the milestone threshold.

This fails in two scenarios:

**Concurrent insertion race:** `poll-active-markets.ts` detects the milestone crossed (fresh TikTok API call), inserts poll A with above-threshold stats, transitions the market to "resolving," then calls `resolveMarket()`. If a second concurrent poller (instrumentation startup or another cron instance) inserts poll B with a lower count between poll A's insert and the `resolveMarket()` call, the oracle fetches poll B as the "latest" and resolves NO — even though the milestone was already crossed and recorded.

**Stale cron data:** The `resolve-markets` scheduled cron can call `resolveMarket()` up to 9 minutes after the last poll. If TikTok adjusts the count downward (engagement normalization is common) between the milestone-crossing poll and the cron firing, the latest DB poll shows below-threshold stats and the oracle resolves NO.

In both cases the code was answering "what is the count **right now**?" when the correct question is "was the milestone **ever** reached?".

### Bug 2 — UI: Integer encoding inverted in every display component

The schema defines:
```
outcome: integer // 0=YES, 1=NO
```

`TradePanel.tsx` (where bets are placed) was **correct**: YES button → `outcome=0`, NO button → `outcome=1`. Bets were stored correctly in the database. However, all **display** components used the inverted condition:

```tsx
outcome === 1 ? "YES" : "NO"   // ← WRONG: treats 1 (NO) as YES
```

This silently reversed all labels without affecting stored data, making the bug invisible until a user noticed their bets appeared wrong in the portfolio.

## Working Solution

### Fix 1 — Oracle: query for any poll that ever crossed the threshold

Replace the single-latest-poll lookup with a predicate query across all historical polls.

**Before:**
```typescript
// oracle.ts
const [latestPoll] = await db
  .select({ viewCount: tiktokPolls.viewCount, likeCount: tiktokPolls.likeCount })
  .from(tiktokPolls)
  .where(eq(tiktokPolls.marketId, marketId))
  .orderBy(desc(tiktokPolls.polledAt))
  .limit(1);

const metric =
  market.questionType === "views" ? latestPoll.viewCount : latestPoll.likeCount;

const outcome = metric !== null && metric >= market.milestoneThreshold ? 0 : 1;
```

**After:**
```typescript
// oracle.ts
import { eq, and, desc, gte } from "drizzle-orm";

// Still needed — guards against "no poll data" error
const [latestPoll] = await db
  .select({ viewCount: tiktokPolls.viewCount, likeCount: tiktokPolls.likeCount })
  .from(tiktokPolls)
  .where(eq(tiktokPolls.marketId, marketId))
  .orderBy(desc(tiktokPolls.polledAt))
  .limit(1);

if (!latestPoll) throw new Error(`No poll data for market ${marketId}`);

// YES if milestone was ever crossed in ANY recorded poll.
// NULL counts (deleted/private video) do not satisfy gte → resolve NO correctly.
const metricColumn =
  market.questionType === "views"
    ? tiktokPolls.viewCount
    : tiktokPolls.likeCount;

const [crossedPoll] = await db
  .select({ metric: metricColumn })
  .from(tiktokPolls)
  .where(
    and(
      eq(tiktokPolls.marketId, marketId),
      gte(metricColumn, market.milestoneThreshold)
    )
  )
  .limit(1);

const outcome = crossedPoll !== undefined ? 0 : 1;
```

Key properties:
- `gte` against a NULL column evaluates false in SQL — deleted/private videos resolve NO without special-case handling.
- The query is a set membership check ("does any row satisfy this predicate?"), race-condition-safe regardless of insertion order or concurrent writers.

### Fix 2 — UI: change every display condition from `=== 1` to `=== 0` for YES

```tsx
// BEFORE (wrong — in 6 places across 4 files)
outcome === 1 ? "YES" : "NO"
outcome === 1 ? "text-green" : "text-red"

// AFTER (correct)
outcome === 0 ? "YES" : "NO"
outcome === 0 ? "text-green" : "text-red"
```

Files changed:

| File | Locations |
|---|---|
| `src/app/portfolio/page.tsx` | Active positions side badge (className + text), Resolved "Your Bet" column, Recent Trades outcome |
| `src/app/history/page.tsx` | Trade outcome badge (className + text) |
| `src/components/MarketCard.tsx` | Resolved market outcome label (className + text) |
| `src/components/MarketLiveData.tsx` | Recent trades YES/NO text |

## Key Insight

**Oracle:** Resolution correctness requires asking "was the milestone ever reached?" not "what is the current count?" Use a predicate query across all historical polls (`gte`), not a point-in-time snapshot of the latest row.

**Display:** When a schema uses `0=YES / 1=NO`, every display ternary must branch on `=== 0` for YES. Any component written with `=== 1` for YES silently inverts all labels without affecting stored data — the bug is invisible until a user notices.

## Prevention

### Testing strategies

1. **"Any poll ever" semantics:** Create a market with three synthetic polls: below threshold → above threshold → below threshold. Call `resolveMarket()`. Assert YES. Directly falsifies a latest-only strategy.

2. **Concurrent insertion ordering:** Insert a milestone-crossing poll, then insert a lower-stat poll with a later `polledAt`. Assert resolution is still YES.

3. **Threshold boundary exactness:** `metric === threshold - 1` → NO. `metric === threshold` → YES. Confirms `gte` (not `gt`) is used.

4. **Idempotency:** Resolve a market to YES, call `resolveMarket()` again. Assert no change and no error.

5. **Outcome display round-trip:** Place a YES trade (outcome=0), read from DB, pass to each display component, assert each renders "YES". Repeat for NO.

6. **Cross-component consistency snapshot:** Render every display component with outcome=0 and outcome=1. Assert output matches `TradePanel.tsx` (the reference-correct component) for both values.

### Code review checklist

**For resolution code:**
- [ ] Does the query use "any row ever" (`WHERE metric >= threshold`) or "latest row only" (`ORDER BY … LIMIT 1`)? For milestone-based markets, latest-only is almost always wrong.
- [ ] Is the comparison `>=` (gte), not `>`?
- [ ] What happens when no polls exist? Ensure a defined fallback, not `undefined`.
- [ ] Is `resolveMarket()` idempotent if called twice on the same market?

**For outcome display code:**
- [ ] Is there a shared constant/utility for the `0=YES, 1=NO` mapping, or is it inlined?
- [ ] Do all display components agree with `TradePanel.tsx` for both outcome values?
- [ ] Grep for `outcome === 1 ? "YES"` — this pattern is always wrong in this schema.

### Architectural recommendations

1. **Shared `Outcome` constant** — define once, import everywhere:
   ```typescript
   // src/lib/constants.ts or db/schema.ts
   export const Outcome = { YES: 0, NO: 1 } as const;
   ```
   All display components, Drizzle filter queries, and oracle logic import from this. An inline `0` or `1` becomes a lint warning.

2. **`formatOutcome(outcome)` utility** — single function all display components call. When the mapping changes, one file to update.

3. **CI grep rule** — fail on `outcome === 1 ? "YES"` pattern (pre-commit hook or ESLint custom rule).

4. **Milestone events table** — rather than re-querying raw polls at resolution time, write to a `milestone_events` table when any poll crosses the threshold. Resolution queries `milestone_events` instead of re-deriving from raw polls. Makes the milestone-crossed fact durable and explicit.

### Potential future failure modes

- **TikTok count rollbacks:** TikTok corrects inflated counts after spam detection. With the `ANY poll ever` fix, a market will still resolve YES even after the count is revised below threshold. Define explicitly whether resolution is based on peak observed count or current count.
- **Multiple concurrent cron workers:** If serverless scale-out runs two workers simultaneously, both may call `resolveMarket()` for the same market. The current idempotency guard (`WHERE status = 'resolving'`) handles this, but verify it holds under parallel DB connections.
- **New display components added without the convention:** Without the shared `formatOutcome()` utility and lint rule, new developers re-implement the mapping and roughly half will write it inverted.
- **Outcome values as strings across API boundaries:** If JSON serialization coerces `outcome` to a string, `outcome === 0` evaluates false. Validate and coerce at API boundaries using Zod.

## Cross-References

- `src/db/schema.ts` lines 106, 145, 173 — canonical `0=YES, 1=NO` definition
- `src/lib/oracle.ts` — fixed file
- `src/lib/poll-active-markets.ts` — early auto-resolution path that calls `resolveMarket()`
- `src/app/api/cron/resolve-markets/route.ts` — scheduled cron that also calls `resolveMarket()`
- **Note:** `docs/brainstorms/2026-03-28-oracle-and-live-market-page-requirements.md` and early oracle plans contain `1=YES, 0=NO` — this encoding was superseded when the schema settled on `0=YES, 1=NO`. Those documents are historical artifacts and do not reflect current behavior.
