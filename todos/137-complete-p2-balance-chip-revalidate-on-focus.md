---
name: BalanceChip SWR revalidates on every tab focus — unnecessary refetches
description: SWR default revalidateOnFocus:true causes /api/balance to be fetched every time user switches back to the tab
type: performance
status: pending
priority: p2
issue_id: "137"
tags: [code-review, performance, swr, api]
dependencies: []
---

## Problem Statement

`src/components/BalanceChip.tsx:81-83` uses `useSWR("/api/balance", ...)` with no `revalidateOnFocus` config. SWR defaults to `revalidateOnFocus: true`, so every time a user returns to the browser tab, `/api/balance` is fetched. Prediction market users frequently switch tabs (checking TikTok, etc.) — this causes dozens of unnecessary balance fetches per session. The balance is already explicitly `mutate`d after trades and daily reward claims via `globalMutate("/api/balance")`.

## Findings

- **`src/components/BalanceChip.tsx:81-83`**: no `revalidateOnFocus: false` option

## Proposed Solutions

### Option A: Add revalidateOnFocus: false (Recommended)
```ts
const { data } = useSWR<BalanceData>("/api/balance", balanceFetcher, {
  fallbackData: { balance: initialBalance, loginStreak: 0, lastLoginReward: null },
  revalidateOnFocus: false, // balance is updated via explicit mutate after trades/rewards
});
```
- **Effort:** Tiny (1 line)
- **Risk:** None — explicit mutate already handles updates

## Acceptance Criteria
- [ ] `/api/balance` is not fetched on tab focus
- [ ] Balance still updates immediately after trades and daily reward claims

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
