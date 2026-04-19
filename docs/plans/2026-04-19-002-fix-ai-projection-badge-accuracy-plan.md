---
title: "fix: Improve AI projection badge accuracy with multi-signal velocity"
type: fix
status: active
date: 2026-04-19
origin: docs/brainstorms/2026-04-19-ai-projection-badge-accuracy-requirements.md
---

# fix: Improve AI projection badge accuracy with multi-signal velocity

## Overview

The AI projection badge displays ON_TRACK for videos that have plateaued or sharply
decelerated. The root cause is that `computeProjectionLabel` receives a single
`rollingVelocityPerHour` value computed over a 24-hour window (falling back to the
oldest available poll). For a video that grew quickly days ago and since stalled, the
24h average still looks adequate — the badge never sees the plateau.

This plan replaces the single-value velocity input with three signals:
`recentVelocityPerHour` (last ~1h), `allTimeVelocityPerHour` (market history), and
`priorVelocityPerHour` (the hour before recentVelocity, for deceleration detection).
The label is computed from `effectiveVelocity = min(recent, allTime)`, with an
additional deceleration guard that fires AT_RISK when growth halves between windows.

Three files need updating: the pure function (`projection.ts`), the TikTok poll loop
(`poll-active-markets.ts`), and the standalone badge-recalculation cron
(`update-badges/route.ts`) which contains an identical copy of the old velocity logic
and would otherwise silently overwrite correct labels.

---

## Problem Frame

All active markets show ON_TRACK regardless of actual trajectory. Confirmed example:
`/markets/9cd15e27-adb6-4b93-a884-25c3f4ff6a59` visibly cannot reach its milestone
at current growth pace. (see origin: `docs/brainstorms/2026-04-19-ai-projection-badge-accuracy-requirements.md`)

---

## Requirements Trace

- R1. Badge reflects current growth rate, not a stale multi-day average
- R2. Brief spikes do not flip a chronically under-performing video to ON_TRACK or BREAKING_OUT
- R3. Rapid deceleration (velocity halved in 1h) triggers AT_RISK on borderline videos
- R4. High-headroom BREAKING_OUT videos are protected from deceleration false-positives
- R5. Brand-new markets (< 15 min / 0.25h of poll history, i.e., oldest poll window < MIN_WINDOW_HOURS) default to AT_RISK
- R6. A video that stalled days ago (not just in the last hour) still shows AT_RISK

---

## Scope Boundaries

- No schema changes
- No badge rendering changes (`FeedCard.tsx` unchanged)
- No changes to label values (`ON_TRACK`, `AT_RISK`, `BREAKING_OUT`)
- No changes to poll frequency or cron schedule
- No performance optimisation beyond existing `tiktok_polls_market_polled_idx` (already covers all new query patterns)

---

## Context & Research

### Relevant Code and Patterns

- `src/lib/projection.ts` — 30-line pure function, currently takes `{ currentMetric, rollingVelocityPerHour, milestoneThreshold, resolvesAt }`
- `src/lib/poll-active-markets.ts:182–228` — projection block; inserts poll, then runs two sequential DB queries (24h-ago anchor, oldest fallback) before calling `computeProjectionLabel`
- `src/app/api/cron/update-badges/route.ts:76–106` — identical velocity-compute block with same two-query pattern; calls `computeProjectionLabel` with the same old signature
- `src/lib/__tests__/contract.test.ts` — existing pure-function test style to follow: explicit `describe` / `it` blocks, named input variables, `expect().toBe()` / `expect().toBeCloseTo()`
- `src/db/schema.ts:216–233` — `tiktokPolls` table; `viewCount` and `likeCount` are nullable `bigint`. Composite index `tiktok_polls_market_polled_idx` on `(marketId, polledAt)` covers all new range queries.

### Institutional Learnings

- **Neon timestamp safety** (`docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`): Drizzle ORM `mode: "date"` timestamps are safe on Vercel (UTC). On local non-UTC machines they are not. Run any new timing tests under `TZ=America/New_York` as well as `TZ=UTC`.
- **Bigint handling** (`docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md`): `viewCount` and `likeCount` come back as JS `BigInt` from Drizzle — always wrap in `Number()` before arithmetic.
- **Projection-label serialiser gap** (`docs/solutions/logic-errors/projection-label-impossible-precondition-and-missing-serialization.md`): The `GET /api/markets` serializer was fixed in an earlier bug to include `projectionLabel`. No serializer change needed here. Also notes that no tests existed for `projection.ts` and calls that out as a gap — this plan creates them.
- **Time-window precondition rule** (same doc): Always state the minimum observation window required. For `poll1h`, require `polledAt` within the last 3h. For `poll2h`, within the last 4h. Both windows are short enough that any active 24–168h market will satisfy them after the first two poll cycles.

---

## Key Technical Decisions

- **Three velocity signals, conservative minimum**: `effectiveVelocity = min(recentVelocity, allTimeVelocity)`. Catches both current stalls (low `recent`) and historically weak videos that temporarily spiked (low `allTime`). This is a deliberate conservatism bias (R1, R2, R6). (see origin)
- **priorVelocity window matches recentVelocity window**: Both are ~1-hour windows (1h-offset). Computing `priorVelocity` over the inter-poll gap (~10 min) would produce noisy, apples-to-oranges comparisons. (see origin)
- **poll1h bounds: 1h–3h ago; poll2h bounds: 2h–4h ago**: Upper bound caps staleness when the cron is delayed. Lower bound ensures the two anchor queries are clearly distinct windows. After fetching both, if they resolve to the same DB row (`poll1h.id === poll2h.id`), `priorVelocityPerHour` is set to `null` (deceleration skipped).
- **Three parallel queries per market** (`Promise.all`): Acceptable at current market volume (~10–15 active). The bulk `lastPollRows` pattern from `poll-active-markets.ts:71` is a more scalable alternative if market count grows significantly. That optimization is deferred.
- **Deceleration guard preserves BREAKING_OUT headroom**: The fourth `isDecelerating` condition (`recentVelocity < requiredVelocity × BREAKING_OUT_RATIO`) ensures a video at 5× required pace that slowed from 10× to 5× stays BREAKING_OUT. Only borderline videos are demoted. (see origin)
- **Named constants in `projection.ts`**: `DECELERATION_THRESHOLD`, `BREAKING_OUT_RATIO`, `ON_TRACK_RATIO`, `MIN_WINDOW_HOURS` are module-level **exported** constants. Both calling files (`poll-active-markets.ts` and `update-badges/route.ts`) import `MIN_WINDOW_HOURS` to apply the minimum-window guard before calling `computeProjectionLabel`. They do not duplicate threshold values.

---

## Open Questions

### Resolved During Planning

- **Does `update-badges/route.ts` need updating?** Yes — it contains an identical copy of the 24h-window velocity block. If not updated it will silently overwrite the correct labels written by the poll loop. (confirmed by reading the file)
- **Does `update-badges/route.ts` fetch `polledAt` for anchor queries?** Currently its per-market queries fetch `viewCount`/`likeCount`/`polledAt` already (line 77). The `currentMetric` source (`latestPollByMarket`) does NOT include `polledAt`, but that is only needed for the anchor rows — which are fetched separately and will include `polledAt`.
- **Index coverage for new queries?** The existing `tiktok_polls_market_polled_idx` on `(marketId, polledAt)` fully covers `WHERE marketId = ? AND polledAt BETWEEN ? AND ?` with `ORDER BY polledAt DESC LIMIT 1`. No new indexes needed.

### Deferred to Implementation

- Whether to batch the three anchor queries across all market IDs (reduces DB round trips from 3×N to 3 total). Defer unless market count grows past ~50.
- Exact Drizzle query syntax for `gte`/`lte` time bounds — implementation-time detail.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Algorithm flow for each market per poll cycle:**

```
tiktokPolls DB
  ├── poll1h   → latest poll with polledAt BETWEEN (now-3h) AND (now-1h)
  ├── poll2h   → latest poll with polledAt BETWEEN (now-4h) AND (now-2h)
  └── oldest   → oldest poll ever for this market

currentMetric = just-fetched TikTok stat (poll-active-markets)
                or latestPollByMarket stored value (update-badges, ≤10 min old)

--- Callers apply MIN_WINDOW_HOURS guard before calling computeProjectionLabel ---

recentVelocity   = (currentMetric - poll1h.metric) / (now - poll1h.polledAt) in hours
                   fallback to oldest if poll1h unavailable (disables priorVelocity)
                   null if resulting window < MIN_WINDOW_HOURS
allTimeVelocity  = (currentMetric - oldest.metric) / (now - oldest.polledAt) in hours
                   null if window < MIN_WINDOW_HOURS
priorVelocity    = (poll1h.metric - poll2h.metric) / (poll1h.polledAt - poll2h.polledAt) in hours
                   null if poll2h unavailable, same row as poll1h, or poll1h fell back to oldest
                   Denominator uses .getTime() on Drizzle mode:"date" Date objects
                   If any intermediate velocity is negative (TikTok count correction), treat as null

effectiveVelocity = min(recentVelocity, allTimeVelocity)
                    null if either input is null (null means "unable to measure", not zero)
```

**Market age regimes:**

| Market age | poll1h | poll2h | Effective behaviour |
|---|---|---|---|
| 0–15 min | absent | absent | Both velocities null (window < MIN_WINDOW_HOURS) → AT_RISK (R5) |
| 15–60 min | absent | absent | poll1h falls back to oldest; recentVelocity ≈ allTimeVelocity; priorVelocity null; deceleration disabled |
| 60 min–3h | poll1h from ~1h window available | may be absent | All three signals potentially available |
| 3h+ | all three anchor windows fully populated | | Full algorithm runs |

**Label decision matrix:**

| hoursRemaining | viewsRemaining | effectiveVelocity | isDecelerating | ratio | Label |
|---|---|---|---|---|---|
| ≤ 0 | any | any | any | any | AT_RISK |
| > 0 | ≤ 0 | any | any | any | BREAKING_OUT |
| > 0 | > 0 | null or ≤ 0 | any | any | AT_RISK |
| > 0 | > 0 | > 0 | true | any | AT_RISK |
| > 0 | > 0 | > 0 | false | ≥ 1.1 | BREAKING_OUT |
| > 0 | > 0 | > 0 | false | ≥ 0.8 | ON_TRACK |
| > 0 | > 0 | > 0 | false | < 0.8 | AT_RISK |

**`isDecelerating` fires only when all four are true:**
1. `priorVelocityPerHour` is not null
2. `priorVelocity > 0`
3. `recentVelocity < priorVelocity × 0.5`
4. `recentVelocity < requiredVelocity × 1.1` (protects high-headroom BREAKING_OUT)

---

## Implementation Units

- [ ] **Unit 1: Refactor `computeProjectionLabel` — new signature, algorithm, and tests**

**Goal:** Replace the single-velocity signature with three velocity inputs, extract named constants, implement the min-based effective velocity and guarded deceleration signal, and create a full unit-test suite.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** None — pure function change, no DB or caller dependencies.

**Files:**
- Modify: `src/lib/projection.ts`
- Create: `src/lib/__tests__/projection.test.ts`

**Approach:**
- Extract module-level **exported** constants: `DECELERATION_THRESHOLD = 0.5`, `BREAKING_OUT_RATIO = 1.1`, `ON_TRACK_RATIO = 0.8`, `MIN_WINDOW_HOURS = 0.25` (callers import `MIN_WINDOW_HOURS` to gate velocity computation)
- New input shape: `{ currentMetric, recentVelocityPerHour, allTimeVelocityPerHour, priorVelocityPerHour, milestoneThreshold, resolvesAt }` — all three velocity inputs accept `number | null`
- Compute `requiredVelocity` first (needed for deceleration guard condition 4)
- Compute `effectiveVelocity = min(recentVelocityPerHour, allTimeVelocityPerHour)` — if **either** input is null, result is null (null means "unable to measure", not zero velocity)
- Evaluate `isDecelerating`: all four conditions must hold (see decision matrix above). Note: condition 4 uses `BREAKING_OUT_RATIO` intentionally — this ensures `isDecelerating` can only fire when the video does not already qualify for `BREAKING_OUT` (ratio < 1.1), satisfying R4 by construction.
- Apply label decision matrix top-to-bottom in order shown

**Patterns to follow:**
- `src/lib/__tests__/contract.test.ts` — test structure: `describe("computeProjectionLabel()", ...)` with named `it()` cases

**Test scenarios:**

*Happy path — all signals available:*
- `recentVelocity = 1000/h, allTimeVelocity = 1200/h, priorVelocity = 900/h, required = 800/h` → effectiveVelocity = 1000, ratio = 1.25 ≥ 1.1, no deceleration → `BREAKING_OUT`
- `recentVelocity = 700/h, allTimeVelocity = 750/h, required = 800/h` → ratio = 0.875 ≥ 0.8 → `ON_TRACK`
- `recentVelocity = 200/h, allTimeVelocity = 300/h, required = 800/h` → ratio = 0.25 < 0.8 → `AT_RISK`

*Conservative min catches stale high allTime (R6 — motivating example):*
- `recentVelocity = 5/h` (stalled), `allTimeVelocity = 900/h` (historic), `required = 800/h` → effectiveVelocity = 5, ratio ≈ 0 → `AT_RISK`

*Conservative min catches spike-only recent (R2):*
- `recentVelocity = 2000/h` (spike), `allTimeVelocity = 200/h` (chronic under-performer), `required = 800/h` → effectiveVelocity = 200, ratio = 0.25 → `AT_RISK`

*Deceleration fires for borderline cases (R3):*
- `priorVelocity = 800/h, recentVelocity = 300/h` (< 50%), `required = 500/h` → recentVelocity (300) < required × 1.1 (550) → `isDecelerating = true` → `AT_RISK`

*Deceleration does NOT fire for high-headroom videos (R4):*
- `priorVelocity = 5000/h, recentVelocity = 2000/h` (< 50%), `required = 500/h` → recentVelocity (2000) ≥ required × 1.1 (550) → `isDecelerating = false` → `BREAKING_OUT`

*Deceleration skipped when `priorVelocityPerHour` is null:*
- `priorVelocityPerHour = null, recentVelocity = 10/h, required = 500/h` → `isDecelerating = false`, falls through to ratio check → `AT_RISK` (ratio < 0.8)

*Edge cases — null/zero velocities (R5):*
- Both `recentVelocityPerHour` and `allTimeVelocityPerHour` null → effectiveVelocity null → `AT_RISK`
- `effectiveVelocity = 0` → `AT_RISK`
- `effectiveVelocity < 0` (rare: views dropped) → `AT_RISK`

*Boundary conditions:*
- `viewsRemaining ≤ 0` (milestone already crossed) → `BREAKING_OUT` regardless of velocity
- `hoursRemaining ≤ 0` (past deadline) → `AT_RISK` regardless of velocity

**Verification:**
- `npm test` passes with all new `projection.test.ts` cases green
- TypeScript compiler accepts the new signature (callers in Unit 2/3 will fail until updated — that is expected)

---

- [ ] **Unit 2: Update velocity computation in `poll-active-markets.ts`**

**Goal:** Replace the two-query 24h-window block with three parallel queries for `poll1h`, `poll2h`, and `pollOldest`, compute the three velocity values with correct fallback logic, and call `computeProjectionLabel` with the new signature.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** Unit 1 (new `computeProjectionLabel` signature must exist)

**Files:**
- Modify: `src/lib/poll-active-markets.ts`

**Approach:**

Replace the block at lines 188–222 (the projection label section inside `pollAllActiveMarkets`).

Query design — all three run via `Promise.all`:
- `poll1h`: latest poll with `polledAt BETWEEN (now − 3h) AND (now − 1h)`, `ORDER BY polledAt DESC LIMIT 1`
- `poll2h`: latest poll with `polledAt BETWEEN (now − 4h) AND (now − 2h)`, `ORDER BY polledAt DESC LIMIT 1`
- `pollOldest`: oldest poll for this market, `ORDER BY polledAt ASC LIMIT 1`

After fetching all three, apply null-metric guard: if the relevant metric column
(`viewCount` or `likeCount` per `market.questionType`) is null on any anchor row,
treat that row as unavailable.

Velocity computation:
- `recentVelocity`: use `poll1h` if available; fall back to `pollOldest`; null if window < `MIN_WINDOW_HOURS`
- `allTimeVelocity`: use `pollOldest` if available; null if window < `MIN_WINDOW_HOURS`
- `priorVelocity`: use `poll1h` and `poll2h` if both available AND `poll1h.id !== poll2h.id`; null otherwise. Denominator: `(poll1h.polledAt.getTime() - poll2h.polledAt.getTime()) / 3_600_000`

When `poll1h` falls back to `pollOldest`: `recentVelocity === allTimeVelocity`, `priorVelocityPerHour = null`, deceleration disabled. This is correct behavior for new markets.

All timestamp arithmetic uses `.getTime()` on Drizzle `mode: "date"` values (safe on Vercel/UTC). Wrap all `viewCount`/`likeCount` BigInt values in `Number()` before arithmetic.

**Patterns to follow:**
- Existing `Promise.all` query pattern is not yet used in this file, but is standard JS — straightforward parallel query expansion
- Bigint wrapping: `Number(market.questionType === "views" ? poll.viewCount : poll.likeCount)` — already used throughout the file
- Import `gte` from `drizzle-orm` alongside the existing `lte` import (line 3 — `gte` is not currently imported but is required for the lower time-bound of each BETWEEN query)

**Test scenarios:**
- Integration: after forcing a poll cycle (`GET /api/cron/poll-tiktok?force=true` if available, or triggering the instrumentation endpoint), check that the example market `9cd15e27-adb6-4b93-a884-25c3f4ff6a59` now shows AT_RISK in the feed
- Regression: a market with consistent strong growth should continue to show BREAKING_OUT or ON_TRACK after the change

**Verification:**
- TypeScript compilation clean (no type errors from new function signature)
- The projection label block runs without throwing in server logs on the next poll cycle
- Market `9cd15e27-*` badge flips from ON_TRACK to AT_RISK

---

- [ ] **Unit 3: Update velocity computation in `update-badges/route.ts`**

**Goal:** Apply the same three-query, three-signal pattern to the standalone badge-recalculation cron so it does not silently overwrite labels computed by the poll loop.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** Unit 1 (new `computeProjectionLabel` signature)

**Files:**
- Modify: `src/app/api/cron/update-badges/route.ts`

**Approach:**

Replace lines 51 and 76–106 (the `twentyFourHoursAgo` variable and the two per-market historical queries).

`currentMetric` continues to come from the `latestPollByMarket` bulk query (already fetched at the top of the route). No change to the bulk `DISTINCT ON` query.

Per-market: run the same three queries as Unit 2 via `Promise.all`:
- `poll1h`: `polledAt BETWEEN (now − 3h) AND (now − 1h)`, `DESC LIMIT 1`
- `poll2h`: `polledAt BETWEEN (now − 4h) AND (now − 2h)`, `DESC LIMIT 1`
- `pollOldest`: `ASC LIMIT 1`

Note: `latestPollByMarket` does NOT include `polledAt`. All three anchor queries must
select `polledAt` as well as the metric columns so that `windowHours` can be computed.

Apply identical null-metric guard, fallback logic, and velocity computation as Unit 2.

**Patterns to follow:**
- Existing `update-badges/route.ts` structure (loop over markets, guard `!market.resolvesAt` and missing poll, update DB after computing label)
- Import `gte` from `drizzle-orm` alongside the existing `lte` import (line 4 — `gte` is not currently imported)

**Test scenarios:**
- After calling `GET /api/cron/update-badges` (with bearer auth), the same market `9cd15e27-*` should show AT_RISK
- A market that was correctly labelled BREAKING_OUT by the poll loop should not be demoted by update-badges running afterward

**Verification:**
- TypeScript compilation clean
- `GET /api/cron/update-badges` returns `{ updated: N, skipped: 0 }` with N > 0 on a real environment with active markets

---

## System-Wide Impact

- **API surface:** `computeProjectionLabel` is a private internal function (not exported as an API route). Both callers are in this repo. No external contract change.
- **`projectionLabel` DB column:** type does not change (`ON_TRACK | AT_RISK | BREAKING_OUT`). The serializer in `GET /api/markets` already exposes it. No migration needed.
- **Race between poll loop and update-badges cron:** Both write to `markets.projectionLabel`. After this fix both use the same algorithm, so the last write wins safely. No ordering dependency introduced.
- **Badge rendering (`FeedCard.tsx`):** Unchanged. Renders whatever label is stored.
- **Unchanged invariants:** `shouldPoll` cooldown logic, poll insert guard (`stats !== null`), auto-resolve flow, and the `milestoneThreshold` BigInt comparison are all untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `poll1h` unavailable for markets < 1h old (all polls in last hour) | Fallback to `pollOldest` produces `recentVelocity = allTimeVelocity`; `priorVelocity = null`; badge conservatively AT_RISK — correct per R5 |
| `poll2h` same row as `poll1h` (market 1–2h old, only one poll ≥ 1h ago) | Guard: if same `.id`, set `priorVelocityPerHour = null`; deceleration disabled — acceptable behaviour, market too new for trend detection |
| `viewCount` / `likeCount` null on anchor rows (partial TikWM responses from before the null-guard was added) | Null-metric guard treats such rows as missing — falls back to older anchor or disables the affected signal |
| `allTimeVelocity` drags down a genuinely recovering market (min() conservatism) | Accepted trade-off per R4 error-mode preference: false negatives (AT_RISK when improving) preferred over false positives (ON_TRACK when stalling) |
| Unit 1 breaking change leaves callers in a TypeScript error state until Units 2/3 land | Land all three units in a single branch and PR — do not merge Unit 1 alone |

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-19-ai-projection-badge-accuracy-requirements.md](docs/brainstorms/2026-04-19-ai-projection-badge-accuracy-requirements.md)
- Related code: `src/lib/projection.ts`, `src/lib/poll-active-markets.ts`, `src/app/api/cron/update-badges/route.ts`
- Related solutions: `docs/solutions/logic-errors/projection-label-impossible-precondition-and-missing-serialization.md`, `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`
