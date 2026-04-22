---
status: pending
priority: p2
issue_id: "090"
tags: [code-review, tiktok, api, database]
dependencies: []
---

# POST /api/markets Missing Initial tiktokPolls Insert for TikTok Markets

## Problem Statement

`POST /api/markets` (the agent-accessible market creation endpoint) inserts an initial `priceSnapshots` row for markets published immediately, but does not insert an initial `tiktokPolls` row for TikTok markets. This means TikTok markets created via the API have no baseline poll data — the oracle cannot resolve them until the first cron poll runs (up to 15 minutes later).

Compare with the admin action path (`createMarket` in `admin.ts`), which correctly inserts an initial poll row.

## Findings

From `src/app/api/markets/route.ts` (approx lines 97–125):

```ts
await db.transaction(async (tx) => {
  await tx.insert(markets).values({ ... });

  if (data.publishImmediately) {
    // ✅ price snapshot inserted
    const prices = allPrices([0, 0], data.bParameter);
    await tx.insert(priceSnapshots).values({ ... });
    // ❌ NO tiktokPolls insert for platform === "tiktok"
  }
});
```

The admin action `createMarket` in `src/lib/actions/admin.ts` inserts `tiktokPolls` on creation:
```ts
if (platform === "tiktok" && videoId) {
  await tx.insert(tiktokPolls).values({ marketId, viewCount: ..., likeCount: ..., polledAt: new Date() });
}
```

The API route doesn't replicate this.

## Proposed Solutions

### Option A: Add tiktokPolls Insert to the Transaction
In the `POST /api/markets` transaction, after the market insert, check platform and insert initial poll row:

```ts
if (data.publishImmediately) {
  // existing price snapshot
  const prices = allPrices([0, 0], data.bParameter);
  await tx.insert(priceSnapshots).values({ ... });

  // Add initial poll for TikTok
  if (data.platform === "tiktok" && data.initialViewCount !== undefined) {
    await tx.insert(tiktokPolls).values({
      id: crypto.randomUUID(),
      marketId,
      viewCount: BigInt(data.initialViewCount),
      likeCount: data.initialLikeCount ? BigInt(data.initialLikeCount) : null,
      polledAt: new Date(),
    });
  }
}
```

**Pros:** Consistent with admin action; baseline data available immediately
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A — add initial poll insert inside the existing transaction block, mirroring the admin action pattern.

## Technical Details

- **Affected file:** `src/app/api/markets/route.ts`
- **Schema addition needed:** `initialLikeCount` optional field in `CreateMarketSchema`
- **Import needed:** `tiktokPolls` from `@/db/schema`

## Acceptance Criteria

- [ ] TikTok markets created via API with `publishImmediately: true` have a `tiktokPolls` row inserted in the same transaction
- [ ] Oracle can resolve newly created TikTok markets without waiting for first cron cycle
- [ ] YouTube markets unaffected

## Work Log

- 2026-03-29: Identified by agent-native-reviewer agent during TikTok integration code review
