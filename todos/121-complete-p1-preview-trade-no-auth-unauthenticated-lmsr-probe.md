---
name: previewTrade server action has no auth check
description: unauthenticated callers can probe LMSR pricing and enumerate market IDs via previewTrade
type: bug
status: pending
priority: p1
issue_id: "121"
tags: [code-review, security, authentication]
dependencies: []
---

## Problem Statement

`previewTrade()` in `src/lib/actions/trade.ts:42` is a `"use server"` action with no authentication check. Any unauthenticated caller can invoke it to enumerate valid market IDs (server responds differently for valid vs invalid IDs) and reconstruct internal LMSR market state from the precise share/cost/price data returned.

**Why:** Auth was added to `buyShares` and `sellShares` but overlooked for the preview action.

## Findings

- **`src/lib/actions/trade.ts:42-82`**: `previewTrade()` proceeds directly to DB and LMSR math without `const session = await auth()`
- No rate limiting on server actions means unlimited unauthenticated calls

## Proposed Solutions

### Option A: Add auth check at top of previewTrade (Recommended)
```ts
const session = await auth();
if (!session?.user?.id) return { error: "Not authenticated" };
```
- **Effort:** Tiny (2 lines)
- **Risk:** None — preview is only useful to authenticated users who can trade

## Acceptance Criteria
- [ ] `previewTrade` returns `{ error: "Not authenticated" }` for unauthenticated callers
- [ ] TradePanel still works correctly for authenticated users

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
