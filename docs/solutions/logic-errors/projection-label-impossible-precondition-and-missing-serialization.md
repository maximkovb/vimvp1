---
title: "AI Projection Badge never visible — logic flaw and serializer omission"
category: logic-errors
date: 2026-04-16
tags:
  - projection-badge
  - poll-worker
  - api-serializer
  - 24h-markets
  - calibration
  - next-js
  - typescript
  - ui-bugs
  - data-pipeline
---

## Symptom

The AI Projection Badge (ON TRACK / AT RISK / BREAKING OUT pill on `FeedCard`) was never visible in the UI for any market. No error was thrown. The badge simply never appeared.

---

## Root Cause Analysis

Two independent bugs, both required to be fixed for the badge to appear.

### Bug 1 — Impossible precondition for 24h markets

`computeProjectionLabel` in `src/lib/projection.ts` was designed around a `metric24hAgo` parameter: it subtracted the view count from 24 hours prior from the current count to derive rolling velocity, then linearly extrapolated to the resolution deadline.

Because most markets have a 24-hour duration, the market resolves before a poll record that is ≥24h old can ever exist. The function had no alternative code path — it returned the literal fallback `"ON_TRACK"` but the poller only called it when `metric24hAgo` was non-null, so `projectionLabel` was never written to the DB. The guard condition for computing a label was structurally impossible to satisfy within the market's lifetime.

### Bug 2 — Serializer silently dropped the column

The `serialize()` helper inside `GET /api/markets` built a plain-object response from each DB row using an explicit object literal. `projectionLabel` was not included in that object. Even after Bug 1 was fixed and the DB column received values, those values were stripped from every API response before reaching the client.

No error was thrown. `FeedCard` renders the badge conditionally (`projectionLabel && ...`), so absence of the key produced an empty render rather than any visible failure.

---

## Fix

### Step 1 — Schema migration

Added two nullable columns to `markets` via `drizzle/0005_markets_projection_data.sql`:

```sql
ALTER TABLE "markets" ADD COLUMN "channel_avg_views" integer;
ALTER TABLE "markets" ADD COLUMN "published_at" timestamp;
```

`channel_avg_views` — channel's mean views per recent video (from Phase 2 suggestion API), stored at market creation.
`published_at` — original video publish date; used to anchor `videoAgeHours` and `resolutionAgeHours` to the video's actual growth curve rather than market creation time.

Both are stored in `src/lib/actions/admin.ts` and `src/app/api/markets/route.ts` at creation time.

### Step 2 — Rewrite `computeProjectionLabel`

Eliminated the `metric24hAgo` dependency entirely. The new function delegates to `computeExpectedOutcome` from `src/lib/calibration.ts` — the same logarithmic velocity + channel floor model already used for milestone calibration — and compares projected outcome to milestone threshold:

```ts
export function computeProjectionLabel({
  currentMetric,
  videoAgeHours,
  resolutionAgeHours,
  milestoneThreshold,
  channelAvgViews,
}: {
  currentMetric: number;
  videoAgeHours: number;
  resolutionAgeHours: number;
  milestoneThreshold: number;
  channelAvgViews: number;
}): ProjectionLabel {
  if (currentMetric >= milestoneThreshold) return "BREAKING_OUT";

  const projected = computeExpectedOutcome(
    currentMetric,
    videoAgeHours,
    resolutionAgeHours,
    channelAvgViews
  );
  const ratio = projected / milestoneThreshold;

  if (ratio >= 1.1) return "BREAKING_OUT";
  if (ratio >= 0.8) return "ON_TRACK";
  return "AT_RISK";
}
```

Works from the first poll. No historical records required.

### Step 3 — Update the poller

`src/lib/poll-active-markets.ts` now derives both time arguments from `market.publishedAt`, falling back to `market.createdAt` for pre-migration markets:

```ts
const origin = market.publishedAt ?? market.createdAt;
const nowMs = Date.now();
const videoAgeHours = Math.max((nowMs - origin.getTime()) / 3_600_000, 0.1);
const resolutionAgeHours = Math.max(
  (market.resolvesAt.getTime() - origin.getTime()) / 3_600_000,
  videoAgeHours + 0.1
);

const label = computeProjectionLabel({
  currentMetric,
  videoAgeHours,
  resolutionAgeHours,
  milestoneThreshold: threshold,
  channelAvgViews: market.channelAvgViews ?? 0,
});
```

`resolutionAgeHours` floor of `videoAgeHours + 0.1` prevents a zero-length window if `publishedAt` equals `resolvesAt`. `channelAvgViews ?? 0` degrades gracefully to velocity-only projection for pre-migration markets.

### Step 4 — Fix the serializer

Added one line to `serialize()` in `src/app/api/markets/route.ts`:

```ts
projectionLabel: m.projectionLabel ?? null,
```

The `?? null` converts `undefined` (Drizzle's value for unset nullable columns) to an explicit JSON `null`, keeping the client type contract stable and making the key always present in the response.

---

## Prevention

### For time-based logic

Before writing any function that depends on a rolling delta:

1. State the precondition explicitly: "this function requires data from interval W; markets last D hours; therefore the label will first be computable at hour W." If W ≥ D, the feature is a no-op.
2. Verify the function produces meaningfully different output at t=early, t=mid, t=near-resolution. If all three calls return the same label, the time dimension is not working.
3. Check all three `RESOLUTION_HOURS` values (24h, 48h, 72h). A design that works silently only for 72h markets is a latent bug.

### For new DB columns that need to reach the frontend

Follow this column lifecycle checklist every time:

- **Schema** — column in Drizzle schema, migration generated and run
- **Serializers** — grep for every `serialize` function and every `return { ... }` object literal that builds market data. All of them must map the new field explicitly.
- **API type** — add to `src/types/market.ts → MarketData` with an explicit TypeScript type (not inferred)
- **Component props** — add to consumer interfaces (`FeedCard`, `MarketHUD`, etc.); trace the full pass-through
- **Conditional rendering** — decide whether `field && <Component />` is appropriate. If the field is expected to be present most of the time, log or flag its absence rather than silently rendering nothing

### Tests that would have caught these bugs

**Bug 1:**
- Unit test `computeProjectionLabel` with `videoAgeHours=1`, `resolutionAgeHours=25` — verify label is non-trivial and changes at mid-market vs early-market
- Integration test: create market, trigger poll, assert `projectionLabel` in DB is non-null

**Bug 2:**
- Unit test `serialize()` with `projectionLabel: "ON_TRACK"` — assert `result[0].projectionLabel === "ON_TRACK"`
- Unit test `serialize()` with `projectionLabel: null` — assert key is present with value `null` (not absent)
- API shape test: `GET /api/markets` response objects must contain the key `projectionLabel` regardless of value

---

## See Also

- `docs/solutions/logic-errors/llm-contract-calibration-bias-fix.md` — same domain: calibration math using velocity + channel baseline. The v2 projection algorithm reuses the same logarithmic growth model.
- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — same route (`GET /api/markets`) had a related data-shape bug; both caused feed cards to show missing data.
- `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md` — related precedent: poll history queries producing wrong results led to invisible UI updates; same failure mode (badge not showing), different root cause.
- `docs/plans/2026-04-16-002-feat-ai-projection-badge-plan.md` — the v1 design this fix supersedes; its 24h-history requirement was the direct source of Bug 1. Treat as historical.
- Wiki: `projects/virality/pages/features/getspike-parity-features.md` § 3 — canonical shipped-state record
- Wiki: `projects/virality/pages/architecture/calibrated-probability.md` — the calibration system whose math the v2 algorithm reuses
- Wiki: `projects/virality/pages/architecture/tiktok-polling-live-data.md` — where `computeProjectionLabel` lives in the poll loop
