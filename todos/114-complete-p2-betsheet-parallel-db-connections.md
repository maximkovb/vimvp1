---
status: pending
priority: p2
issue_id: "114"
tags: [code-review, performance, database]
dependencies: [108]
---

# BetSheet opens 4–5 parallel DB queries against Neon's single connection

## Problem Statement

When the BetSheet opens, two async operations fire simultaneously: SWR fetches `/api/markets/[id]` (which runs 3 parallel DB queries via `Promise.all`) and a `getUserPosition` server action (which runs `auth()` + 1 DB query). That is 4–5 concurrent queries contending on Neon's single `max: 1` connection. They serialize behind each other, turning the sheet open into a sequential DB pipeline with 4–5× expected latency.

## Findings

- `src/components/BetSheet.tsx:37-53`: SWR + `getUserPosition` both fire on `open`
- `src/app/api/markets/[id]/route.ts:31-59`: `Promise.all([priceSnapshots, trades, tiktokPolls])` — 3 queries
- `src/lib/actions/trade.ts:403-412`: `getUserPosition` — `auth()` + `positions` query
- `src/db/index.ts:15`: `max: 1` Neon pool
- Performance agent: "4–5 concurrent queries trying to acquire the single Neon connection simultaneously. The first to acquire it blocks all others."
- On a cold Neon connection (serverless wake-up) this can push sheet-open latency over 2 seconds

## Proposed Solutions

### Option 1: Include user position in `/api/markets/[id]` response

**Approach:** Move `getUserPosition` logic into the API route handler. BetSheet only needs one SWR fetch; the response includes both market data and the user's position.

```ts
// /api/markets/[id]/route.ts
const session = await auth();
const [priceSnapshots, recentTrades, polls, positionRows] = await Promise.all([
  // existing queries...
  session?.user?.id
    ? db.select().from(positions).where(and(eq(positions.userId, session.user.id), eq(positions.marketId, id)))
    : Promise.resolve([]),
]);
// Include position in response
```

**Pros:** One HTTP request on sheet open; all DB queries run in a single `Promise.all` against the pool; simpler BetSheet code
**Cons:** API response shape changes (add `userPosition` field); authenticated and unauthenticated responses differ

**Effort:** 1 hour
**Risk:** Low

### Option 2: Sequence the fetches (getUserPosition after SWR resolves)

**Approach:** Call `getUserPosition` in a `.then()` callback after the SWR fetch completes, not in a separate `useEffect`.

**Pros:** No API changes; reduces peak concurrency from 5 to 3+1
**Cons:** Position loads after chart — slightly delayed UX for sell controls

**Effort:** 30 minutes
**Risk:** Low

## Recommended Action

Option 1 — consolidating into one authenticated API fetch is the right architectural direction and eliminates the contention entirely.

## Technical Details

**Affected files:**
- `src/app/api/markets/[id]/route.ts` — add position query to `Promise.all`, include in response
- `src/components/BetSheet.tsx` — remove `getUserPosition` `useEffect`, read position from `marketData`

## Acceptance Criteria

- [ ] BetSheet makes exactly one HTTP request when opening
- [ ] User position is displayed correctly when the response includes it
- [ ] No regression in chart display or trade panel functionality

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (performance-oracle agent)
