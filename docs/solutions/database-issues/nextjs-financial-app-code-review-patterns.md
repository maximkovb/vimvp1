---
title: "Next.js Financial App: Code Review Patterns & Fixes"
date: 2026-03-22
category: database-issues
tags:
  - nextjs
  - drizzle-orm
  - race-conditions
  - security
  - postgres
  - lmsr
  - prediction-markets
  - transactions
related_files:
  - src/lib/actions/auth.ts
  - src/lib/actions/economy.ts
  - src/lib/actions/trade.ts
  - src/lib/services/payout.ts
  - src/app/api/cron/resolve-markets/route.ts
  - src/middleware.ts
  - src/db/schema.ts
summary: |
  Comprehensive patterns discovered during a full code review of a Next.js 15
  prediction-markets app using LMSR AMM, Drizzle ORM, Neon Postgres, and Auth.js v5.
  Covers TOCTOU race conditions, N+1 query elimination, optimistic locking, lifecycle
  state machine gaps, admin auth consolidation, and security headers.
---

# Next.js Financial App: Code Review Patterns & Fixes

## Context

Reviewed a binary prediction market platform (virality) with:
- **Stack**: Next.js 15 App Router, Drizzle ORM, Neon PostgreSQL, Auth.js v5
- **Domain**: LMSR AMM markets, coin economy (signup bonus, daily rewards, trades, payouts)
- **Infra**: Vercel serverless, cron jobs via Vercel Cron

---

## Pattern 1: TOCTOU Race Conditions in User Creation

**Problem:** Signup flow did a `SELECT` to check if email exists, then inserted — classic check-then-act race allowing duplicate account creation with NULL unique index bypass in Postgres.

**Fix:** Remove the pre-check entirely. Wrap the INSERT in a transaction and catch the `23505` unique violation directly:

```typescript
// src/lib/actions/auth.ts
try {
  await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, passwordHash }).returning();
    await tx.insert(coinTransactions).values({
      userId: user.id,
      type: "signup_bonus",
      amount: SIGNUP_BONUS,
      referenceId: user.id, // idempotency key
    });
  });
} catch (e: unknown) {
  if ((e as { code?: string })?.code === "23505") {
    return { error: "Email already in use" };
  }
  throw e;
}
```

**Why:** `NULL != NULL` in Postgres unique constraints means a naive `SELECT` check can race with a concurrent insert and both succeed. Letting the DB enforce uniqueness atomically is the only correct approach.

---

## Pattern 2: Double-Claim Race in Reward Transactions

**Problem:** Daily reward claim checked `lastRewardAt` timestamp, then inserted the transaction — a race window allowed two concurrent requests to both pass the check and double-credit coins.

**Fix:** Use `SELECT FOR UPDATE` inside the transaction to hold a row lock while checking:

```typescript
// src/lib/actions/economy.ts
await db.transaction(async (tx) => {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .for("update"); // acquires row lock

  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lastRewardUTC = user.lastRewardAt
    ? new Date(Date.UTC(
        user.lastRewardAt.getUTCFullYear(),
        user.lastRewardAt.getUTCMonth(),
        user.lastRewardAt.getUTCDate()
      ))
    : null;

  if (lastRewardUTC && lastRewardUTC >= todayUTC) {
    throw new Error("Already claimed today");
  }

  await tx.insert(coinTransactions).values({
    userId: user.id,
    type: "daily_login",
    amount: DAILY_REWARD,
    referenceId: todayUTC.toISOString().slice(0, 10), // idempotency: YYYY-MM-DD
  });
  await tx.update(users).set({ lastRewardAt: now, coins: sql`${users.coins} + ${DAILY_REWARD}` })
    .where(eq(users.id, user.id));
});
```

**Key:** The `referenceId` set to the UTC date string also provides an idempotency key for the ledger — even if somehow two transactions committed, the unique constraint on `(userId, type, referenceId)` would prevent duplication.

---

## Pattern 3: Optimistic Locking for Concurrent Trades

**Problem:** Two users buying shares simultaneously on the same LMSR market could read the same `b` (liquidity parameter) and `q` (outstanding shares), compute overlapping prices, and diverge the ledger.

**Fix:** Add a `version` column to `markets`, increment it on every trade, and retry on version conflict:

```typescript
// src/lib/actions/trade.ts
class ConcurrentTradeError extends Error {}

async function buyShares(marketId: string, shares: number, userId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.transaction(async (tx) => {
        const [market] = await tx.select().from(markets).where(eq(markets.id, marketId));

        // Compute cost using LMSR
        const cost = lmsrCost(market, shares);

        const updated = await tx
          .update(markets)
          .set({
            outstandingYesShares: sql`${markets.outstandingYesShares} + ${shares}`,
            version: sql`${markets.version} + 1`,
          })
          .where(and(eq(markets.id, marketId), eq(markets.version, market.version)))
          .returning();

        if (updated.length === 0) throw new ConcurrentTradeError("Version mismatch");

        // debit user, insert position, record ledger...
      });
      return; // success
    } catch (e) {
      if (e instanceof ConcurrentTradeError && attempt < 2) continue;
      throw e;
    }
  }
}
```

**Why:** Optimistic locking avoids `SELECT FOR UPDATE` table-level contention across users while still protecting against lost updates.

---

## Pattern 4: N+1 Elimination in Payout Distribution

**Problem:** `distributePayout` and `refundPositions` looped over each position winner/loser individually — O(N) round-trips to the database.

**Fix:** Use a VALUES CTE to batch all updates into two SQL statements:

```typescript
// src/lib/services/payout.ts
const winnerRows = winners.map((w) => sql`(${w.userId}::uuid, ${w.payout}::integer)`);

await tx.execute(sql`
  UPDATE users SET coins = users.coins + v.payout
  FROM (VALUES ${sql.join(winnerRows, sql`, `)}) AS v(user_id, payout)
  WHERE users.id = v.user_id
`);

const txRows = winners.map((w) => sql`(
  gen_random_uuid(), ${w.userId}::uuid, ${"payout"}::text,
  ${w.payout}::integer, ${marketId}, now()
)`);

await tx.execute(sql`
  INSERT INTO coin_transactions (id, user_id, type, amount, reference_id, created_at)
  VALUES ${sql.join(txRows, sql`, `)}
`);
```

**Impact:** Reduces O(N) DB round-trips to O(1) regardless of winner count. Essential for popular markets with hundreds of positions.

---

## Pattern 5: Cron Lifecycle State Machine Gaps

**Problem:** The market state machine (`active → halted → resolving → resolved`) had a gap: if the cron ran infrequently or a market was created at the exact transition boundary, markets could skip the `halted` state and remain `active` past `resolvesAt` without ever moving to `resolving`.

**Fix:** Add a catch-all two-step transition alongside the normal path. The safety net must go through `halted` first — never directly `active → resolving`. The `halted` state is the trade-closing gate; bypassing it leaves a window where trades pass the `status='active'` guard while resolution is computing payouts.

```typescript
// src/app/api/cron/resolve-markets/route.ts

// Normal: active → halted (5min before resolvesAt)
await db.update(markets).set({ status: "halted" })
  .where(and(eq(markets.status, "active"), sql`${markets.haltsAt} <= ${now}`));

// Normal: halted → resolving
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));

// Safety net: active markets that missed the halt window — two-step, not direct
await db.update(markets).set({ status: "halted" })
  .where(and(eq(markets.status, "active"), sql`${markets.resolvesAt} <= ${now}`));
await db.update(markets).set({ status: "resolving" })
  .where(and(eq(markets.status, "halted"), sql`${markets.resolvesAt} <= ${now}`));
```

**Principle:** State machines in distributed cron contexts must handle missed transitions. Each cron run should be idempotent and include catch-all recovery paths for every skippable state. Any path to `resolving` must pass through `halted` — this is not optional.

---

## Pattern 6: Admin Auth Consolidation

**Problem:** Admin authorization was copy-pasted across four server actions as an inline email comparison:

```typescript
// repeated 4 times — fragile and inconsistent
if (session?.user?.email !== process.env.ADMIN_EMAIL) {
  return { error: "Unauthorized" };
}
```

**Fix:** Centralize in `src/lib/admin.ts`:

```typescript
export function isAdmin(session: Session | null): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;
  return session?.user?.email === adminEmail;
}

export function requireAdmin(session: Session | null): { error: string } | null {
  if (!isAdmin(session)) return { error: "Unauthorized" };
  return null;
}
```

Then in each action:
```typescript
const authError = requireAdmin(session);
if (authError) return authError;
```

**Why:** A single function is the only safe pattern — it guarantees that env var absence (misconfiguration) correctly locks out everyone rather than accidentally granting access.

---

## Pattern 7: Auth.js OAuth Signup Bonus Gap

**Problem:** `signUp` server action created the coin ledger entry for email/password signups. But Google OAuth users bypassed the action entirely — their accounts were created by Auth.js's `DrizzleAdapter`, leaving no signup bonus.

**Fix:** Use Auth.js `events.createUser` hook:

```typescript
// src/lib/auth.ts
events: {
  async createUser({ user }) {
    if (!user.id) return;
    await db.insert(coinTransactions).values({
      userId: user.id,
      type: "signup_bonus",
      amount: SIGNUP_BONUS,
      referenceId: user.id,
    });
    await db.update(users)
      .set({ coins: sql`${users.coins} + ${SIGNUP_BONUS}` })
      .where(eq(users.id, user.id));
  }
}
```

**Key insight:** Any time you have two authentication paths, audit whether both paths trigger the same post-signup business logic. Events/hooks are the correct intercept point for adapter-created users.

---

## Pattern 8: Edge Middleware for Route Protection

**Problem:** Protected routes (`/admin`, `/portfolio`) relied solely on server-side session checks inside page components. This allowed unauthenticated requests to reach page rendering, wasting server compute.

**Fix:** Create `src/middleware.ts` using Auth.js's `auth()` export:

```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");
  const isPortfolioRoute = req.nextUrl.pathname.startsWith("/portfolio");

  if ((isAdminRoute || isPortfolioRoute) && !req.auth) {
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }
});

export const config = {
  matcher: ["/admin/:path*", "/portfolio/:path*"],
};
```

**Note:** Middleware runs at the edge before server components — this is defense-in-depth, not a replacement for server-side auth checks.

---

## Pattern 9: Database Index on Polling Hot Path

**Problem:** The YouTube poll lookup (`determineOutcome`) ran `ORDER BY polledAt DESC LIMIT 1` on `youtubePolls` with no index, causing sequential scans on every market resolution.

**Fix:** Add a composite index in `schema.ts`:

```typescript
export const youtubePollsMarketPolledIdx = index("youtube_polls_market_polled_idx")
  .on(youtubePolls.marketId, youtubePolls.polledAt);
```

**Rule:** Any column combination used in a `WHERE + ORDER BY` hot path needs a composite index in that order.

---

## Pattern 10: UTC Normalization for Date Comparisons

**Problem:** Daily reward "already claimed today" check used `setHours(0,0,0,0)` which normalizes to the server's local timezone — incorrect for UTC-stored timestamps.

**Fix:**
```typescript
// Wrong — server-local midnight
const today = new Date();
today.setHours(0, 0, 0, 0);

// Correct — UTC midnight
const todayUTC = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate()
));
```

**Rule:** All timestamp comparisons against DB values must use UTC normalization. `setHours(0,0,0,0)` is always wrong in a serverless context where the server timezone is unpredictable.

---

## Prevention Checklist

Use this checklist for any financial server action or cron job PR:

### Transactions & Races
- [ ] No pre-check SELECT before INSERT — catch `23505` instead
- [ ] Double-claim guards use `SELECT FOR UPDATE` inside transaction
- [ ] Concurrent mutations use optimistic locking with retry loop
- [ ] `referenceId` on every coin ledger entry for idempotency

### Queries
- [ ] No N+1 loops over DB records — use VALUES CTE for bulk updates
- [ ] Every hot-path `WHERE + ORDER BY` combination has a composite index
- [ ] Unbounded queries (`SELECT *` with no LIMIT) are guarded

### State Machines
- [ ] Cron transitions include catch-all recovery for missed states
- [ ] All state transitions are idempotent (re-running is safe)

### Auth & Security
- [ ] Admin check uses centralized `isAdmin()` — never inline
- [ ] Env var absence (e.g., `ADMIN_EMAIL` unset) defaults to deny
- [ ] OAuth and credentials paths both trigger post-signup hooks
- [ ] Protected routes guarded in middleware (edge) AND server components
- [ ] Security headers (CSP, X-Frame-Options, HSTS) set in `next.config.ts`

### Time & Dates
- [ ] All date normalization uses `Date.UTC(...)` not `setHours(0,0,0,0)`
- [ ] Cron time comparisons use server UTC, not local time

---

## Related Issues Still Open

| Todo | Description |
|------|-------------|
| `001-pending-p1` | Rotate all credentials exposed in `.env.local.example` |
| `010-pending-p2` | Add rate limiting to trade and reward actions |
| `013-pending-p2` | Add JSON API read endpoints for agent-native parity |
| `019-pending-p3` | Upgrade next-auth from beta.30 to stable v5 |
