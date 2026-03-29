---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security, correctness]
dependencies: ["007"]
---

# Fix claimDailyReward Double-Claim Race Condition

## Problem Statement

`claimDailyReward` uses a `db.transaction()` but PostgreSQL's default `READ COMMITTED` isolation level means two concurrent requests from the same user can both read yesterday's `lastLoginReward`, both pass the "already claimed" check, and both claim the reward — granting 50–150 coins twice. The `coinTransactions` unique index provides no protection because `daily_login` entries use `referenceId = NULL`, and PostgreSQL allows multiple rows with the same `(userId, NULL, type)`.

## Findings

- `src/lib/actions/economy.ts:25-94`: transaction uses default READ COMMITTED isolation
- Two concurrent calls read `lastLoginReward` as yesterday before either updates it
- Both pass the `if (lastRewardUTC === todayUTC)` check on line 44
- Both update `balance` and insert `coinTransactions` — double reward granted
- `coinTransactions` unique index on `(userId, referenceId, type)`: referenceId is NULL for daily_login; PostgreSQL treats NULL != NULL so the constraint never fires
- This is directly exploitable: concurrent HTTP requests via curl or browser DevTools

## Proposed Solutions

### Option 1: SELECT FOR UPDATE + Deterministic referenceId

**Approach:**
1. Add `.for("update")` to the user SELECT inside the transaction to acquire a row-level lock, serializing concurrent requests for the same user.
2. Use today's ISO date string as `referenceId` (e.g., `"2026-03-22"`) so the unique index actually blocks duplicate insertions.

**Pros:** Belt-and-suspenders protection; minimal code change; fixes root cause at both layers
**Cons:** Requires Drizzle `for("update")` syntax (supported)

**Effort:** 1 hour
**Risk:** Low

---

### Option 2: Use SERIALIZABLE Isolation

**Approach:** Set the transaction isolation level to SERIALIZABLE.

**Pros:** Database handles the concurrency automatically
**Cons:** Higher chance of serialization failures requiring retries; overkill for this case

**Effort:** 30 minutes
**Risk:** Medium (retry logic needed)

## Recommended Action

Option 1. Both the SELECT FOR UPDATE lock AND the deterministic referenceId fix are needed, as they defend against different failure modes.

## Technical Details

**Affected files:**
- `src/lib/actions/economy.ts:27-94` — claimDailyReward

**Code change:**
```typescript
// Add .for("update") to serialize concurrent claims
const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");

// Use date string as referenceId for idempotency
await tx.insert(coinTransactions).values({
  userId,
  amount: totalReward.toFixed(2),
  type: "daily_login",
  referenceId: todayUTC.toISOString().slice(0, 10), // "2026-03-22"
});
```

**Related:** Issue 007 (coinTransactions unique index NULL bypass) — fixing referenceId here also partially addresses that issue.

## Acceptance Criteria

- [ ] `SELECT FOR UPDATE` used when reading user row in claimDailyReward
- [ ] `daily_login` coinTransaction uses today's ISO date as referenceId
- [ ] Concurrent duplicate claims are blocked at both application and database level
- [ ] Single legitimate claim per day still works correctly
- [ ] Streak calculation remains correct

## Work Log

### 2026-03-22 - Discovery

**By:** Security sentinel (code review)
