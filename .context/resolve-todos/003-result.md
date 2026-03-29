# Todo 003 Result: Add SELECT FOR UPDATE to claimDailyReward

## Files Changed

- `src/lib/actions/economy.ts`

## What Was Changed

Added `.for("update")` to the user SELECT query inside the `claimDailyReward` transaction. This acquires a row-level lock on the user row at the start of the transaction, serializing concurrent claims for the same user and preventing the race condition where two simultaneous requests could both read a stale `lastLoginReward` and both proceed to grant the daily reward.

Before:
```typescript
const [user] = await tx
  .select()
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);
```

After:
```typescript
const [user] = await tx
  .select()
  .from(users)
  .where(eq(users.id, userId))
  .limit(1)
  .for("update");
```

## Confirmation: referenceId Fix Already in Place

Todo 004 was already applied. The `coinTransactions` insert at line 86 includes:

```typescript
referenceId: todayUTC.toISOString().slice(0, 10),
```

No changes were needed for todo 004.
