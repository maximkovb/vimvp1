---
name: AdminMarketActions uses status: string instead of MarketStatus union type
description: Loose string type on status prop prevents TypeScript from catching invalid status values and new statuses being unhandled
type: quality
status: pending
priority: p2
issue_id: "139"
tags: [code-review, typescript, type-safety]
dependencies: []
---

## Problem Statement

`AdminMarketActions.tsx:15` defines `status: string` in its props interface. All the `status === "draft"`, `status === "failed"` comparisons are unguarded string comparisons. TypeScript cannot warn if a caller passes an invalid status, and cannot provide exhaustiveness checking as new statuses are added.

## Findings

- **`src/components/AdminMarketActions.tsx:15`**: `status: string` instead of `MarketStatus`
- `MarketStatus` is already exported from `src/db/schema.ts`

## Proposed Solutions

### Option A: Import and use MarketStatus
```ts
import type { MarketStatus } from "@/db/schema";

interface Props {
  marketId: string;
  status: MarketStatus;
}
```
- **Effort:** Tiny (import + type change)
- **Risk:** None — may surface existing callers passing raw strings that need updating

## Acceptance Criteria
- [ ] `AdminMarketActions` props typed with `MarketStatus`
- [ ] All callers pass typed status values

## Work Log
- 2026-04-06: Identified by TypeScript reviewer during ce:review
