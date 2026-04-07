---
name: MarketLiveData makes redundant getUserPosition server action call on resolution
description: MarketLiveData.tsx calls getUserPosition() on resolution, but market.userPosition is already available in the SWR response
type: bug
status: pending
priority: p2
issue_id: "138"
tags: [code-review, architecture, performance, swr]
dependencies: []
---

## Problem Statement

When a market resolves, `MarketLiveData.tsx:91-107` calls `getUserPosition(marketId)` (a Server Action) to populate `ResolutionReveal`. But `GET /api/markets/[id]` already returns `userPosition` in its response, and that data is in the SWR `data` object that `MarketLiveData` already holds. This is a redundant round-trip to the DB on resolution. `BetSheet` correctly reads `marketData?.userPosition` from SWR.

## Findings

- **`src/components/MarketLiveData.tsx:91-107`**: `getUserPosition(marketId)` called in useEffect on resolution
- **`src/app/api/markets/[id]/route.ts:69`**: already returns `userPosition` in the response
- `BetSheet.tsx` uses the SWR data correctly — inconsistent pattern

## Proposed Solutions

### Option A: Read userPosition from SWR data instead of calling the server action
```ts
// Replace the useEffect calling getUserPosition with:
const [userPosition, setUserPosition] = useState(initialData.userPosition ?? null);
// Update from live SWR data:
useEffect(() => {
  if (data?.userPosition !== undefined) setUserPosition(data.userPosition);
}, [data?.userPosition]);
```
- **Effort:** Small
- **Risk:** Low — removes the server action import and useEffect

## Acceptance Criteria
- [ ] No `getUserPosition` server action call in `MarketLiveData`
- [ ] Resolution reveal still shows correct user position
- [ ] One fewer DB query per market resolution reveal

## Work Log
- 2026-04-06: Identified by architecture-strategist and TypeScript reviewer during ce:review
