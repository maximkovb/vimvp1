---
status: complete
priority: p2
issue_id: "062"
tags: [code-review, security, calibration, server-action]
dependencies: []
---

# Re-derive `videoAgeHours` server-side from `publishedAt` rather than trusting client-submitted value

## Problem Statement

`createMarket()` in `src/lib/actions/admin.ts` reads `videoAgeHours` and `channelAvgViews` from the form's hidden fields — values the client submits. These are used directly in `computeExpectedOutcome()` to compute the milestone floor guard.

A client that submits `videoAgeHours = "0.1"` (minimum allowed) inflates the velocity projection used as the floor. Combined with `channelAvgViews = "0"`, the floor degrades to near-zero, effectively allowing any milestone to pass. Both fields have `parseFloat` + range-clamp guards but no semantic verification.

Additionally, `videoAgeHours` as submitted by the client is the age at the time the suggestion was generated — which may be 10+ minutes stale by the time the admin hits submit. For a prediction market, a 30-minute age difference can meaningfully shift the velocity floor.

## Findings

- **`src/lib/actions/admin.ts` lines 380–401**: both `channelAvgViews` and `videoAgeHours` are read from `formData` and clamped but not verified against any server-authoritative source.
- The comment at line 378–379 acknowledges this: "channelAvgViews and videoAgeHours are provided by the client... degrades to velocity-only projection."
- **`publishedAt`** is already submitted as a hidden field in `page.tsx` (line 382 in the diff: `value={videoStats?.title ?? ""}` etc.) — wait, actually it's not currently a hidden field. The `publishedAt` is available in `videoStats` on the client but is not currently forwarded to the server.
- `channelAvgViews` is harder to re-derive server-side without a re-fetch. A practical short-term fix is to re-derive `videoAgeHours` from a submitted `publishedAt` timestamp (already available in `videoStats`) and treat `channelAvgViews` as trusted-but-sanity-clamped.

## Proposed Solutions

### Option A — Submit `publishedAt` and re-derive age server-side (Recommended)

1. Add `<input type="hidden" name="publishedAt" value={videoStats?.publishedAt ?? ""} />` to `page.tsx`
2. In `createMarket()`, compute `videoAgeHoursVal` from the submitted ISO date string instead of the pre-computed float:

```typescript
const publishedAtStr = formData.get("publishedAt") as string | null;
const videoAgeHoursVal = publishedAtStr && !isNaN(Date.parse(publishedAtStr))
  ? Math.max((Date.now() - new Date(publishedAtStr).getTime()) / 3_600_000, 0.1)
  : 1;
```

- **Pros**: Server computes the age at submit time (not suggestion time); can't be inflated by the client.
- **Cons**: Adds one more hidden field; requires ISO 8601 validation before parsing.
- **Effort**: Small
- **Risk**: Low — `publishedAt` is a YouTube API value already validated upstream

### Option B — Re-fetch channel data inside `createMarket()`

Call `generateMarketSuggestion()` data or use a short-TTL server-side cache keyed by `videoId` to retrieve `channelAvgViews` without trusting the form.

- **Pros**: Both fields are fully server-authoritative.
- **Cons**: Additional latency or caching complexity; over-engineered for the trust level of an admin-only form.
- **Effort**: Medium
- **Risk**: Medium

## Recommended Action

Option A. The trust-boundary improvement is meaningful for `videoAgeHours` (it eliminates the inflation attack and corrects the staleness issue). `channelAvgViews` remains client-supplied but is less exploitable (zeroing it only degrades the floor to velocity-only, which was the previous behaviour before this PR).

## Acceptance Criteria

- [ ] `createMarket()` computes `videoAgeHoursVal` from a submitted `publishedAt` timestamp, not from the `videoAgeHours` hidden field
- [ ] `publishedAt` hidden field added to `page.tsx` form submission
- [ ] Invalid or missing `publishedAt` falls back to `videoAgeHours = 1` (existing safe default)
- [ ] Manual form submission with `videoAgeHours = 0.001` does not bypass the floor

## Work Log

- 2026-03-27: Identified during `/ce:review` — security-sentinel (F-1), architecture-strategist
