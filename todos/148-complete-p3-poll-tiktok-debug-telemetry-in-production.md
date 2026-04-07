---
name: poll-tiktok cron includes debug telemetry unconditionally in production
description: skipReasons and per-market details arrays are computed and returned on every cron invocation — wasted CPU in steady-state
type: performance
status: pending
priority: p3
issue_id: "148"
tags: [code-review, performance, cron, simplicity]
dependencies: []
---

## Problem Statement

`src/app/api/cron/poll-tiktok/route.ts:64-76` computes a detailed `skipReasons` diagnostic payload (string slicing, math, object construction per market) on every invocation where all markets are within cooldown — which is the **common steady-state case** since the cron runs every 10 minutes with a matching cooldown. Separately, the `details` array (lines 84-101) logs per-market view/like counts on every poll run and is included unconditionally in the JSON response.

Both are development telemetry, not operational monitoring data.

## Findings

- **`src/app/api/cron/poll-tiktok/route.ts:64-76`**: `skipReasons` computed and returned always
- **`src/app/api/cron/poll-tiktok/route.ts:84,98,101,177`**: `details` array included in every response

## Proposed Solutions

### Option A: Gate behind ?debug=true query param
```ts
const debug = new URL(request.url).searchParams.get("debug") === "true";
// Only compute skipReasons and details when debug=true
```
- **Effort:** Small (wrap existing logic in `if (debug)`)
- **Risk:** None

## Acceptance Criteria
- [ ] Production cron runs do not compute or return `skipReasons` or `details`
- [ ] `?debug=true` (with bearer auth) still returns the diagnostic payload
- [ ] ~21 LOC removed from hot path

## Work Log
- 2026-04-06: Identified by code-simplicity-reviewer during ce:review
