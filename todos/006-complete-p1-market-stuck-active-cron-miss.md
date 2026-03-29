---
status: pending
priority: p1
issue_id: "006"
tags: [code-review, correctness, lifecycle]
dependencies: []
---

# Fix Market Stuck in Active When Cron Misses the 5-Minute Halt Window

## Problem Statement

The cron fires every 5 minutes. The halt window is exactly 5 minutes before resolution. If the cron is delayed or fails during that specific window, `active → halted` transition is missed. The next cron checks `status = 'halted' AND resolvesAt <= now` — but the market is still `active`, so it's never promoted to `resolving`. The market is permanently stuck in `active` past its resolution time, with no automatic recovery. Manual `cancelMarket` won't work for active-past-resolution markets; `manualResolve` requires `failed` or `resolving` status.

## Findings

- `src/app/api/cron/resolve-markets/route.ts:19-31`: two separate bulk updates
  - Line 22-25: `active → halted WHERE haltsAt <= now`
  - Line 28-31: `halted → resolving WHERE resolvesAt <= now`
- There is no `active → resolving` direct path
- If a market reaches `resolvesAt` while still `active`, no cron step picks it up
- Admin cannot use `manualResolve` (requires `failed`/`resolving` state)
- Admin cannot use `cancelMarket` without triggering refunds prematurely

## Proposed Solutions

### Option 1: Add Catch-All active → resolving Transition

**Approach:** Add a third bulk transition that directly moves `active` markets past their `resolvesAt` into `resolving`, skipping the halted state.

```typescript
// Catch-all: active markets past resolvesAt go directly to resolving
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
```

**Pros:** Simple one-liner; handles missed halt window automatically
**Cons:** Markets skip the `halted` state (no longer shows "halted" UI briefly); trading could have continued until resolution time

**Effort:** 15 minutes
**Risk:** Low

---

### Option 2: Expand Halted → Resolving to Include Active

**Approach:** Change the `halted → resolving` query to also pick up `active` markets past resolution time.

```typescript
.where(and(
  or(eq(markets.status, "halted"), eq(markets.status, "active")),
  sql`${markets.resolvesAt} <= ${now}`
))
```

**Pros:** Minimal change
**Cons:** Same as Option 1 — active markets skip halted state

**Effort:** 10 minutes
**Risk:** Low

## Recommended Action

Option 1. Add the catch-all transition as the third step in the cron, after the existing two transitions. This makes the cron resilient to missed windows without changing the normal flow.

## Technical Details

**Affected files:**
- `src/app/api/cron/resolve-markets/route.ts:19-31`

Add after line 31:
```typescript
// Safety net: active markets past resolvesAt skipped the halt window — promote directly
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
```

## Acceptance Criteria

- [ ] An `active` market whose `resolvesAt` has passed is picked up by the cron and promoted to `resolving`
- [ ] Normal `active → halted → resolving` flow is unchanged for markets processed on time
- [ ] No markets can remain permanently stuck past their resolution time without admin intervention

## Work Log

### 2026-03-22 - Discovery

**By:** Architecture strategist (code review)
