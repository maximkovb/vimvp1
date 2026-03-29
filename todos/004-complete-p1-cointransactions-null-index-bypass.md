---
status: pending
priority: p1
issue_id: "004"
tags: [code-review, security, correctness, database]
dependencies: []
---

# Fix coinTransactions Unique Index — NULL referenceId Bypasses Constraint

## Problem Statement

The `coinTransactions` table has a unique index on `(userId, referenceId, type)` intended to prevent duplicate ledger entries. However, PostgreSQL does not consider two NULL values equal in a unique index, so any transaction with `referenceId = NULL` can be inserted unlimited times. Both `daily_login` and `signup_bonus` transactions set `referenceId = NULL`, making the index useless for idempotency on these types.

## Findings

- `src/db/schema.ts:247-252`: `uniqueIndex` on `(userId, referenceId, type)`
- `referenceId` is nullable (`text("reference_id")` with no `.notNull()`)
- `claimDailyReward` (economy.ts:85) omits referenceId → NULL
- `signUp` (auth.ts:48) omits referenceId → NULL
- PostgreSQL: `NULL != NULL` in unique constraint evaluation → duplicates pass
- The index provides a false sense of security; application-layer guards are the only real protection

## Proposed Solutions

### Option 1: Deterministic referenceId for Each Type

**Approach:** Assign meaningful referenceId values:
- `signup_bonus` → use `userId` (one bonus per user forever)
- `daily_login` → use ISO date string `"YYYY-MM-DD"` (one per user per day)
- `trade` → already uses `tradeId` (correct)
- `payout` / `refund` → already uses `marketId` (correct)

**Pros:** Makes the unique index actually enforce idempotency at DB level; no schema migration needed
**Cons:** Requires code changes in signUp and claimDailyReward

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Partial Unique Index per Type

**Approach:** Create separate partial unique indexes:
- `UNIQUE (userId) WHERE type = 'signup_bonus'`
- `UNIQUE (userId, referenceId) WHERE type = 'daily_login' AND referenceId IS NOT NULL`

**Pros:** DB enforces constraints cleanly
**Cons:** Requires migration; more complex schema

**Effort:** 2 hours
**Risk:** Low (additive migration)

## Recommended Action

Option 1 — minimal code change, no migration required, and directly fixes the idempotency gaps. Coordinate with todos 002 and 003 which also touch these insert sites.

## Technical Details

**Affected files:**
- `src/lib/actions/auth.ts:48` — add `referenceId: userId` to signup_bonus
- `src/lib/actions/economy.ts:82-85` — add `referenceId: todayISO` to daily_login
- `src/db/schema.ts:247-252` — document the convention in a comment

## Acceptance Criteria

- [ ] `signup_bonus` coinTransaction uses userId as referenceId
- [ ] `daily_login` coinTransaction uses ISO date string as referenceId
- [ ] Duplicate signup_bonus insertions are blocked by the unique index
- [ ] Duplicate daily_login insertions for the same day are blocked by the unique index
- [ ] Existing coinTransactions for other types (trade, payout, refund) are unaffected

## Work Log

### 2026-03-22 - Discovery

**By:** TypeScript reviewer + Security sentinel (code review)
