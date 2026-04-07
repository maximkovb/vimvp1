---
status: pending
priority: p1
issue_id: "071"
tags: [code-review, security, api, calibration]
dependencies: []
---

# `POST /api/markets` floor guard bypassable — `videoAgeHours` is fully caller-controlled

## Problem Statement

The floor guard in `POST /api/markets` uses caller-supplied `videoAgeHours` directly. A bearer-token holder can send `initialViewCount: 0, channelAvgViews: 0, videoAgeHours: <anything>` to make `computeExpectedOutcome` return 0, causing `data.milestoneThreshold < 0` to be false for any positive milestone. The guard is silently bypassed and a market with `milestoneThreshold: 1` (near-certain YES) can be created.

By contrast, `createMarket()` in `admin.ts` correctly re-derives `videoAgeHours` server-side from a submitted `publishedAt` ISO timestamp (todo #062 fix). The API route lacks this protection entirely — it has no `publishedAt` field in its schema.

## Findings

- `src/app/api/markets/route.ts` lines 55–73: `videoAgeHours: z.number().min(0.1).optional()` accepted as-is
- `src/lib/actions/admin.ts` lines 402–406: `publishedAt` used to re-derive `videoAgeHours` server-side
- Attack: `POST /api/markets` body with `initialViewCount: 0, channelAvgViews: 0, videoAgeHours: 1` → `computeExpectedOutcome(0, 1, 24, 0) = 0` → any `milestoneThreshold >= 1` passes the floor guard
- The `CRON_SECRET` gate limits exposure to authorized callers, but the semantic integrity of the market should not depend solely on access control

## Proposed Solution

Add `publishedAt: z.string().datetime()` to `CreateMarketSchema`. When present, re-derive `videoAgeHours` server-side:

```typescript
// In CreateMarketSchema:
publishedAt: z.string().datetime(),

// In POST handler, before floor guard:
const publishedAtDate = new Date(data.publishedAt);
const videoAgeHoursVal = Math.max(
  (Date.now() - publishedAtDate.getTime()) / 3_600_000,
  0.1
);
// Use videoAgeHoursVal instead of data.videoAgeHours in computeExpectedOutcome
```

This mirrors exactly what `createMarket()` does and ensures the floor guard reflects real video age regardless of what the caller submits.

**Alternative:** Keep `videoAgeHours` as a fallback when `publishedAt` is absent (backward compat for callers that don't have `publishedAt`), but apply a server-side cap so that `videoAgeHours` cannot make the floor trivially 0.

- **Effort**: Small
- **Risk**: Low — purely additive field; existing callers unaffected if `publishedAt` is optional with a fallback

## Acceptance Criteria

- [ ] `POST /api/markets` computes `videoAgeHours` from `publishedAt` when that field is provided
- [ ] Submitting `initialViewCount: 0, channelAvgViews: 0` with a real `publishedAt` produces a non-zero floor guard (velocity projection from actual video age)
- [ ] AGENTS.md documents `publishedAt` as a recommended field for Phase 3 (from Phase 1 response)
- [ ] Existing API callers omitting `publishedAt` still work (fallback behavior preserved)
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — security-sentinel (P1-2), architecture-strategist (P1-B)
