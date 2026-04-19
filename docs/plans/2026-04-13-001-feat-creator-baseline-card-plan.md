---
title: "feat: Add creator baseline card to market page"
type: feat
status: completed
date: 2026-04-13
origin: docs/brainstorms/2026-04-13-creator-baseline-card-requirements.md
---

# feat: Add Creator Baseline Card to Market Page

## Overview

Add a "Creator Baseline" panel to `/markets/[id]` that shows users whether the
current video is outpacing or underperforming the creator's recent norm — giving
bettors meaningful context before committing YES or NO.

The panel fetches the creator's recent video stats live from TikWM on page load,
computes a views/hr velocity ratio, and renders a three-tier verdict (Ahead /
On pace / Behind) in the left column beneath the existing creator card.

## Problem Statement

Users currently see a video, a milestone threshold, and a YES/NO market price.
They have zero context for whether that threshold is aggressive or conservative
relative to this creator's actual output. Without a velocity baseline, both
price and milestone feel arbitrary.

(see origin: docs/brainstorms/2026-04-13-creator-baseline-card-requirements.md)

## Proposed Solution

A new client component `CreatorBaselineCard` uses SWR to fetch from a new
unauthenticated API route `/api/tiktok/creator-baseline`. That route calls
TikWM's user/posts endpoint in parallel with a single-video stats fetch,
computes the velocity comparison server-side, and returns a typed verdict
object. The component renders collapsed by default, with the verdict visible
in the header.

## Technical Approach

### New Files

| File | Purpose |
|------|---------|
| `src/app/api/tiktok/creator-baseline/route.ts` | API handler — validates inputs, calls TikWM, returns verdict |
| `src/components/CreatorBaselineCard.tsx` | Client component — SWR fetch, expand/collapse, verdict UI |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/constants.ts` | Add `TIKTOK_CREATOR_ID_RE` constant |
| `src/lib/tiktok.ts` | Add `fetchTikTokUserPosts()` and `TikTokUserPost` interface |
| `src/app/markets/[id]/page.tsx` | Import and render `CreatorBaselineCard` |

---

### Phase 1 — Data Layer

#### `src/lib/constants.ts`

Add validation constant for TikTok creator usernames (the `unique_id` format, 
not the numeric video ID format). Used for SSRF prevention before appending to
a TikWM URL.

```typescript
// TikTok username handles: letters, digits, underscores, periods, 1–24 chars.
// Applied to the creatorId param before inclusion in any outbound URL.
export const TIKTOK_CREATOR_ID_RE = /^[a-zA-Z0-9._]{1,24}$/;
```

#### `src/lib/tiktok.ts`

Add new interface and export. Follow the exact same structure as
`fetchTikTokStatsById` — `AbortSignal.timeout(8_000)`, `code !== 0` guard,
`null` for not-found, throw on network error.

```typescript
export interface TikTokUserPost {
  videoId: string;   // d.id — the canonical TikTok video ID
  viewCount: number; // d.play_count
  createdAt: string; // ISO string from d.create_time * 1000
}

/**
 * Fetches a creator's most recent public posts via TikWM.
 * Returns null if the account is not found or private.
 * Throws on network or unexpected HTTP errors.
 *
 * IMPORTANT: d.create_time is Unix seconds — always multiply by 1000.
 */
export async function fetchTikTokUserPosts(
  creatorId: string,
  count = 20
): Promise<TikTokUserPost[] | null> {
  const url =
    `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(creatorId)}&count=${count}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
  const json = await res.json();
  if (json?.code !== 0 || !json?.data?.videos) return null;
  return (json.data.videos as Record<string, unknown>[]).map((v) => ({
    videoId: String(v.id ?? ""),
    viewCount: Number(v.play_count ?? 0),
    createdAt: new Date((Number(v.create_time ?? 0)) * 1000).toISOString(),
  }));
}
```

---

### Phase 2 — API Route

**`src/app/api/tiktok/creator-baseline/route.ts`**

Unauthenticated GET — no `auth()`, no `verifyCronAuth()`. Follows the pattern
of `src/app/api/tiktok/[videoId]/play-url/route.ts`.

**Query params:**
- `creatorId` (required) — TikTok unique_id / username handle
- `videoId` (required) — numeric TikTok video ID (`tikapiPostId ?? videoId`)

**Algorithm:**
1. Validate both params; return 400 on failure.
2. Call `fetchTikTokUserPosts(creatorId)` and `fetchTikTokStatsById(videoId)` in
   parallel with `Promise.all`.
3. If `fetchTikTokUserPosts` returns `null` → 404 `{ error: "Creator not found" }`.
   If `fetchTikTokStatsById` returns `null` → 422 `{ error: "insufficient_data" }`.
4. Filter baseline: remove posts where `p.videoId === videoId` AND posts older
   than **90 days** (eliminates the age-distortion bias in views/hr for long-
   running creators whose older videos have far lower velocity).
5. If fewer than 3 baseline videos remain, return 422 `{ error: "insufficient_data" }`.
6. Compute `viewsPerHr` for each baseline video: `viewCount / max(ageHours, 1)`.
7. Compute median of baseline velocities.
8. Compute current video velocity from `fetchTikTokStatsById` result.
9. Compute `deltaPercent = round(((videoVph - medianVph) / medianVph) * 100)`.
10. Assign verdict: `"ahead"` if `deltaPercent > 20`, `"behind"` if `< −20`,
    else `"on_pace"`.
11. Return 200 `CreatorBaselineData`.

**Response contracts:**

```typescript
// 200 OK
export interface CreatorBaselineData {
  verdict: "ahead" | "on_pace" | "behind";
  deltaPercent: number;               // signed integer; positive = ahead
  videoViewsPerHr: number;            // rounded integer
  creatorMedianViewsPerHr: number;    // rounded integer
  baselineVideoCount: number;         // videos used for median (after filters)
}

// 400 Bad Request          — { error: "Invalid creatorId format" | "Invalid videoId format" }
// 404 Not Found             — { error: "Creator not found" }
// 422 Unprocessable Entity  — { error: "insufficient_data" }
// 502 Bad Gateway           — { error: "Failed to fetch creator data" }
```

**Error handling table:**

| Condition | Response |
|-----------|----------|
| `creatorId` fails `TIKTOK_CREATOR_ID_RE` | 400 |
| `videoId` fails `TIKTOK_VIDEO_ID_RE` | 400 |
| `fetchTikTokUserPosts` returns `null` | 404 `"Creator not found"` |
| `fetchTikTokStatsById` returns `null` | 422 `"insufficient_data"` |
| Either fetch throws | 502 |
| Fewer than 3 baseline videos after filtering | 422 `"insufficient_data"` |

---

### Phase 3 — Client Component

**`src/components/CreatorBaselineCard.tsx`**

`"use client"` directive. Uses SWR. Collapsed by default.

**Props:**

```typescript
interface CreatorBaselineCardProps {
  creatorId: string;  // videoMetadata.creatorId (may be empty string)
  videoId: string;    // market.tikapiPostId ?? market.videoId
}
```

**SWR config** — creator baseline changes slowly; no re-fetch on focus/reconnect:

```typescript
{
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshInterval: 0,
  dedupingInterval: 300_000,   // 5-minute client-side cache per creatorId
}
```

**Key behaviours:**
- If `creatorId` is empty → pass `null` as SWR key to disable fetch entirely.
  `isLoading` is false and `data` is undefined → renders "not enough data" immediately.
- `baselineFetcher` returns `null` on 422 and throws on other non-OK statuses.
  SWR `error` state (network failure, 500) → also renders "not enough data".
- The fetcher must be **defined at module scope** (not inside the component body)
  to maintain a stable reference — the same discipline enforced by `market-fetcher.ts`.

**Verdict styling:**

| Verdict | Icon | Colour class |
|---------|------|-------------|
| `ahead` | `▲` | `text-green` |
| `on_pace` | `—` | `text-amber-400` |
| `behind` | `▼` | `text-red` |

Header (collapsed state) example:
- Ahead: `▲ Ahead of pace +47%`
- On pace: `— On pace +4%` (uses signed delta, never omitted)
- Behind: `▼ Behind pace −23%`
- Loading: skeleton pulse (`animate-pulse`) in place of the verdict span
- Not enough data: no verdict, header text only (`"Creator Baseline"`)

Expanded state layout — mirror the `grid grid-cols-2 gap-2 pt-1 border-t border-border`
pattern from `LiveEngagementStats.tsx`:

```
┌─────────────────────────────────┐
│ This video     Creator avg      │
│ 43K/hr         29K/hr           │
│                                 │
│ ▲ +47% vs creator median        │
│ Based on 9 recent videos        │
└─────────────────────────────────┘
```

Use `formatCount(n)` from `@/lib/format` for all views/hr numbers.

The expand/collapse toggle is a `<button>` covering the full card header with
`aria-expanded={open}`. This is the accessible disclosure pattern.

---

### Phase 4 — Page Integration

**`src/app/markets/[id]/page.tsx`**

Insert `CreatorBaselineCard` as a sibling of the creator card, inside the
existing `{videoMetadata && (...)}` guard, within the `space-y-4` left column
div. Placement: after the creator card block (line ~134), before the description
block (line ~136).

```tsx
{videoMetadata && (
  <>
    {/* existing creator card */}
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      {/* ... avatar, LiveEngagementStats ... */}
    </div>

    {/* NEW: creator baseline — always render when videoMetadata present */}
    <CreatorBaselineCard
      creatorId={videoMetadata.creatorId ?? ""}
      videoId={market.tikapiPostId ?? market.videoId}
    />
  </>
)}
```

When `videoMetadata` is `null` (older markets), neither the creator card nor the
baseline card renders — no floating orphan. When `creatorId` is absent or empty,
the component skips the fetch and shows "not enough data."

---

## Technical Considerations

- **`create_time` is Unix seconds.** TikWM's user/posts endpoint returns
  `d.create_time` in Unix seconds, not milliseconds. Always convert:
  `new Date(Number(v.create_time) * 1000)`. Do NOT pass `v.create_time`
  directly to `new Date()`. (see learnings: neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md)

- **SSRF guard via `TIKTOK_CREATOR_ID_RE`.** The `creatorId` param is
  appended to an outbound TikWM URL via `encodeURIComponent`. The regex
  must be applied **before** the URL is constructed.

- **No BigInt needed here.** View counts flow from TikWM JSON → JS number
  → arithmetic → JSON response. No Neon `bigint` columns involved. The
  existing `BigInt(stats.viewCount)` pattern is only needed in the polling
  cron that writes to the `tiktok_polls` table.

- **Stable SWR fetcher reference.** Define `baselineFetcher` at module scope
  in `CreatorBaselineCard.tsx`. Do not inline it as a closure inside the
  component — that creates a new function reference on every render and
  breaks SWR's deduplication. (see learnings: neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md)

- **90-day baseline window.** Intentionally narrows the comparison to videos
  published within the last 90 days. This prevents the views/hr metric from
  being distorted by year-old viral outliers or slow-growth archive content.
  The limitation is documented in the component's inline comment.

- **No Neon timestamps involved.** The feature stores nothing in the DB.
  The UTC-offset parse bug (retrieve as epoch ms via `EXTRACT(EPOCH)`) only
  applies to Neon `timestamp` column reads. Not applicable here.

- **`tikapiPostId ?? videoId` for TikWM calls.** `tikapiPostId` is the
  canonical ID from TikWM's `d.id`. Prefer it over `videoId` for any TikWM
  lookup. Fall back to `videoId` for older markets where `tikapiPostId` may
  be null.

## System-Wide Impact

- **Interaction graph:** Page load → SWR mounts → fires `GET /api/tiktok/creator-baseline` →
  route calls `Promise.all([fetchTikTokUserPosts, fetchTikTokStatsById])` → both hit
  `https://www.tikwm.com`. No callbacks, no DB writes, no market state touched.

- **Error propagation:** TikWM network failure → 502 from API route → SWR `error`
  state → component renders "not enough data" UI. Errors are silently swallowed
  in the UI — no toast, no alert. Befitting a supplemental signal (not a core
  feature that warrants surfacing errors to the user).

- **State lifecycle:** Stateless for persistence. Component expand/collapse state
  lives in React `useState` and resets on unmount. No DB writes, no localStorage.

- **API surface parity:** Only affects the new route. No existing endpoints changed.

- **Integration test scenarios:**
  1. Market with valid `creatorId` + ≥ 3 qualifying recent videos → renders verdict.
  2. TikWM returns creator posts but all are > 90 days old → 422 → "not enough data."
  3. `videoId` present in user posts (current video) → excluded from baseline.
  4. `creatorId` empty string → no fetch → immediate "not enough data."
  5. TikWM returns 500 mid-fetch → 502 from route → SWR error → "not enough data."

## Acceptance Criteria

- [ ] **R1** `CreatorBaselineCard` renders as a separate card in the left column, below the creator card, on `/markets/[id]` (all statuses: active, halted, resolved, cancelled).
- [ ] **R2** Card starts collapsed. Header always visible. Clicking/tapping toggles expand.
- [ ] **R3** Verdict is `"Ahead of pace"` when `deltaPercent > 20`; `"On pace"` when `−20 ≤ delta ≤ 20`; `"Behind pace"` when `delta < −20`.
- [ ] **R4** Expanded state shows: this video's views/hr, creator's median views/hr, signed % delta, "Based on N recent videos".
- [ ] **R5** Data fetches live on component mount via `/api/tiktok/creator-baseline`.
- [ ] **R6** Fewer than 3 qualifying baseline videos (after age + exclusion filters) → API returns 422 → "Not enough data yet" state in UI.
- [ ] **R6** TikWM request failure → "Not enough data yet" state in UI.
- [ ] **R7** Empty or absent `creatorId` → no API call → "Not enough data yet" state.
- [ ] **R8** Feature renders correctly on markets in any status.
- [ ] Loading state shows skeleton pulse in the header verdict area while fetch is in flight.
- [ ] Current video is excluded from the baseline calculation.
- [ ] Baseline excludes videos older than 90 days.
- [ ] `TIKTOK_CREATOR_ID_RE` rejects any `creatorId` that does not match `[a-zA-Z0-9._]{1,24}`.
- [ ] `create_time` from TikWM is multiplied by 1000 before use in `new Date()`.
- [ ] `formatCount()` is used for all views/hr display values.
- [ ] SWR does not re-fetch on window focus or reconnect.
- [ ] `baselineFetcher` is defined at module scope, not inside the component body.
- [ ] When `videoMetadata` is null, neither the creator card nor the baseline card renders.

## Dependencies & Risks

| Item | Risk | Mitigation |
|------|------|------------|
| TikWM `user/posts` endpoint shape | Medium — undocumented, may change | Gate on `json?.code === 0 && json?.data?.videos`; return null on any deviation |
| TikWM rate limiting | Low — single request per page view | No concurrent fan-out; 5-min SWR dedup prevents re-fetch spam |
| `creatorId` availability | Low — optional in `videoMetadata` | Component handles empty string gracefully |
| 90-day window may discard all baseline videos for infrequent creators | Medium — results in "not enough data" | Acceptable; document in component comment |
| `tikapiPostId` null for older markets | Low | Fall back to `market.videoId` |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-13-creator-baseline-card-requirements.md](../brainstorms/2026-04-13-creator-baseline-card-requirements.md)
  Key decisions carried forward: velocity ratio over chart, live fetch over stored baseline, "not enough data" state over hiding the card.

### Internal References

- SWR pattern to replicate: `src/components/LiveEngagementStats.tsx:1–45`
- Stable fetcher pattern: `src/lib/market-fetcher.ts:1–12`
- Unauthenticated route template: `src/app/api/tiktok/[videoId]/play-url/route.ts:1–27`
- TikWM single-video fetch (template for new function): `src/lib/tiktok.ts:56–77`
- Existing validation constants: `src/lib/constants.ts`
- Market page insertion point: `src/app/markets/[id]/page.tsx:114–145`
- Design tokens: `src/app/globals.css`
- `formatCount` utility: `src/lib/format.ts`

### Learnings Applied

- `create_time * 1000` conversion: `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`
- Stable SWR fetcher reference: same document
- TikWM API contract (`code: 0` guard, null vs. throw): `docs/plans/2026-03-30-001-feat-replace-tikapi-with-tikwm-plan.md`
- SSRF prevention via input validation: SpecFlow analysis (Gap 4)
- Age-distortion bias in views/hr: SpecFlow analysis (Gap 2)
