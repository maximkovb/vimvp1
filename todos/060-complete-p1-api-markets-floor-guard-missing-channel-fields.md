---
status: complete
priority: p1
issue_id: "060"
tags: [code-review, agent-native, security, calibration]
dependencies: []
---

# `POST /api/markets` bypasses calibration floor guard — `channelAvgViews`/`videoAgeHours` not in schema

## Problem Statement

`createMarket()` (the server action used by the admin UI form) validates that a submitted milestone exceeds `computeExpectedOutcome(initialCount, videoAgeHours, resolutionHours, channelAvgViews)`. This floor is the primary correctness guard that prevents trivially-easy markets.

`POST /api/markets` (the JSON API route used by agents and cron jobs) inserts directly into the DB without calling `createMarket()`. Its `CreateMarketSchema` does not include `channelAvgViews` or `videoAgeHours`, so the floor guard is never run. An agent or script creating markets via the API can submit a milestone equal to 1.01× `currentViews` and it will be accepted without question.

This is a correctness gap: agent-created markets are exempt from the calibration rules that UI-created markets must obey, making them systematically easier.

## Findings

- **`src/app/api/markets/route.ts`** — `CreateMarketSchema` (Zod) lacks `channelAvgViews` and `videoAgeHours` fields. The `db.insert` on line ~61 writes the row without any floor check.
- **`src/lib/actions/admin.ts` lines 391–401** — the floor check runs in `createMarket()` and uses `computeExpectedOutcome()` from `src/lib/calibration.ts`. The identical check is absent from the API route.
- The divergence was introduced in this PR when `createMarket()` was upgraded to use the channel-baseline floor, but the API route was not updated in parallel.

## Proposed Solutions

### Option A — Add floor guard to the API route (Recommended)
Add `channelAvgViews` (optional, default 0) and `videoAgeHours` (optional, default 1) to `CreateMarketSchema`. Replicate the `computeExpectedOutcome` check before the `db.insert`:

```typescript
import { computeExpectedOutcome } from "@/lib/calibration";

const requiredFloor = computeExpectedOutcome(
  parsedData.initialViewCount ?? 0,
  parsedData.videoAgeHours ?? 1,
  parsedData.resolutionHours,
  parsedData.channelAvgViews ?? 0
);
if (parsedData.milestoneThreshold < requiredFloor) {
  return NextResponse.json({ error: "Milestone below expected outcome floor" }, { status: 422 });
}
```

- **Pros**: Full parity with the server action; consistent behaviour across all entry points; agents that supply channel data get proper validation.
- **Cons**: Requires updating callers that currently omit these fields; callers without channel data degrade to velocity-only floor (same as the server action fallback, which is intentional).
- **Effort**: Small
- **Risk**: Low — new fields are optional with fallback defaults; existing callers are unaffected.

### Option B — Move floor guard to a shared utility called from both paths
Extract the floor validation into a helper function in `src/lib/calibration.ts` or a new `src/lib/market-validation.ts`, and call it from both `createMarket()` and the API route.

- **Pros**: Single source of truth for validation logic; less duplication.
- **Cons**: Slightly more refactoring than Option A; same net result.
- **Effort**: Small–Medium

## Recommended Action

Option A. The fix is a few lines in the API route, the fields are already optional with sensible defaults, and it closes the correctness gap immediately.

## Technical Details

- **Affected files**: `src/app/api/markets/route.ts`, `src/lib/calibration.ts` (import only)
- **No DB changes required**

## Acceptance Criteria

- [ ] `POST /api/markets` with `channelAvgViews = 400000`, `videoAgeHours = 2`, `resolutionHours = 72`, and `milestoneThreshold = 100000` returns a 422 (milestone below floor)
- [ ] `POST /api/markets` without `channelAvgViews`/`videoAgeHours` fields still succeeds with a valid milestone (graceful degradation to velocity-only floor)
- [ ] No existing tests broken

## Work Log

- 2026-03-27: Identified during `/ce:review` — agent-native-reviewer, security-sentinel
