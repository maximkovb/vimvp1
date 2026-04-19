---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, performance, reliability, vercel]
dependencies: []
---

# Add Wall-Clock Budget Guard to Poll Loop

## Problem Statement

`pollAllActiveMarkets()` iterates over every active market sequentially with no time budget. As the number of active markets grows (30+), the loop will exceed Vercel's 60-second `maxDuration` for cron functions. When this happens, the function is killed mid-loop, silently dropping the remaining markets — no error, no log, no alert.

## Findings

- `src/lib/poll-active-markets.ts` — sequential `for` loop over all active markets with no deadline guard
- Vercel serverless functions have a hard `maxDuration` (default 10s, configurable up to 60s for Pro)
- Each TikWM API call takes ~500ms–2s; at 30 markets that's 15–60s per poll cycle
- When the process is killed mid-loop, Drizzle transactions in flight may leave partial state
- No `Promise.all` parallelization — all markets polled one after another
- The `shouldPoll()` guard prevents duplicate polls per market but doesn't bound total wall time

## Proposed Solutions

### Option 1: Add a wall-clock deadline check inside the loop (Recommended)

**Approach:** Record `startTime = Date.now()` before the loop. At the top of each iteration, check `Date.now() - startTime > MAX_POLL_DURATION_MS` (e.g., 50_000ms). Break early and log how many markets were skipped.

```typescript
const MAX_DURATION_MS = 50_000; // leave 10s buffer before Vercel's 60s limit
const startTime = Date.now();

for (const market of activeMarkets) {
  if (Date.now() - startTime > MAX_DURATION_MS) {
    console.warn(`[poll] Budget exceeded — skipped ${remaining} markets`);
    break;
  }
  // ... existing poll logic
}
```

**Pros:**
- Prevents silent kill; logs which markets were skipped
- Safe, minimal change to existing sequential logic
- No parallelism risk (TikWM rate limits, DB connections)

**Cons:**
- Markets at the tail of the list always get skipped when overloaded
- Doesn't solve the root capacity problem for very large market sets

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Parallelize with bounded concurrency (p-limit)

**Approach:** Use `p-limit` (already a transitive dep of Next.js) to poll N markets concurrently (e.g., concurrency=3), reducing wall time by ~3x.

**Pros:**
- Faster — 30 markets at concurrency=3 takes ~10–20s instead of 30–60s
- Scales better as market count grows

**Cons:**
- Multiple simultaneous TikWM calls may hit rate limits
- Neon HTTP driver supports concurrent connections, but needs verification
- More complex than Option 1

**Effort:** 2–3 hours

**Risk:** Medium (rate limits, connection pooling)

---

### Option 3: Combine Options 1 + 2

**Approach:** Add deadline guard (Option 1) as an immediate safety net while investigating whether parallelization (Option 2) is safe. Ship Option 1 now, Option 2 later.

**Effort:** 30 min now + 3h later

**Risk:** Low

## Recommended Action

Ship Option 1 immediately (deadline guard) to prevent silent failures. Plan Option 2 as a follow-up once the market count justifies it.

## Technical Details

**Affected files:**
- `src/lib/poll-active-markets.ts` — add `startTime` and budget check in the market loop

**Related components:**
- `vercel.json` — `maxDuration` setting for cron route
- `src/app/api/cron/poll-tiktok/route.ts` — thin wrapper, not affected

**Database changes:**
- None

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** performance-oracle (P1)

## Acceptance Criteria

- [ ] Wall-clock budget constant defined (e.g., `MAX_POLL_DURATION_MS = 50_000`)
- [ ] Loop checks elapsed time at start of each iteration
- [ ] When budget exceeded, loop breaks and logs count of skipped markets
- [ ] Result object includes skipped count for observability
- [ ] Existing tests still pass

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified unbounded sequential loop in poll-active-markets.ts
- Calculated worst-case wall time at 30 markets
- Compared against Vercel 60s maxDuration limit
- Proposed deadline guard as minimal safe fix
