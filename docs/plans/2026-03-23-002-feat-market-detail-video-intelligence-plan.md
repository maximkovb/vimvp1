---
title: "feat: Add Video Intelligence Panel to Market Detail"
type: feat
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-market-detail-video-intelligence-requirements.md
---

# feat: Add Video Intelligence Panel to Market Detail

## Overview

The market detail page (`/markets/[id]`) currently gives users a video embed, a probability price chart, and recent trades — but none of the raw video performance data that determines the market outcome. This plan adds a **Video Intelligence** section above the price chart, containing three new panels: a description of the video, a chart of the video's actual view/like count over time, and a card list of the channel's recent video performance. Together these let users judge whether the milestone target is realistic before placing a trade.

See origin: `docs/brainstorms/2026-03-23-market-detail-video-intelligence-requirements.md`

---

## Problem Statement

Users predicting virality need context that the current page does not provide:

1. **No view/like trajectory** — the `youtubePolls` table records view and like counts over time but this data is never displayed.
2. **No channel baseline** — users cannot tell whether a milestone is ambitious or trivial for a given creator.
3. **No video description** — understanding the video's content is a basic input to any prediction.

The `videoMetadata` JSONB field also does not persist `channelId` or `description`, even though `fetchVideoMetadata` already fetches both — they are used for the contract recommendation and then discarded.

---

## Proposed Solution

A three-phase approach that adds data, then components, then reorganizes the page layout:

1. **Data foundation** — extend `videoMetadata` to persist `channelId` and `description`; update `createMarket` to write them.
2. **New components** — `VideoStatsChart` (view/like trajectory with milestone line), `VideoDescription` (expandable text), `ChannelHistorySection` (async Server Component fetching recent channel videos).
3. **UX reorganization** — restructure the market detail page to group the three new panels into a "Video Intelligence" section placed above the price chart.

---

## Technical Approach

### Architecture

```
src/app/markets/[id]/page.tsx          ← Server Component; adds youtubePolls query
src/db/schema.ts                       ← Extend videoMetadata TypeScript type
src/lib/actions/admin.ts               ← fetchVideoMetadata: add description to fields; createMarket: persist channelId + description
src/lib/youtube.ts                     ← NEW: fetchChannelRecentVideos(channelId)
src/components/VideoStatsChart.tsx     ← NEW: "use client", lightweight-charts v5
src/components/VideoDescription.tsx   ← NEW: "use client", expand/collapse
src/components/ChannelHistorySection.tsx ← NEW: async Server Component (Suspense leaf)
src/components/ChannelHistoryCards.tsx ← NEW: pure presentational, renders card list
```

**Caching strategy:** `fetchChannelRecentVideos` uses Next.js `fetch` with `{ next: { revalidate: 3600 } }` on each underlying HTTP call. This stores channel history in the Next.js data cache for 1 hour per unique `channelId`, avoiding quota burn across page views. No Redis or DB table needed.

**Suspense boundary:** `ChannelHistorySection` is wrapped in `<Suspense>` on the market detail page. This means the rest of the page (video embed, price chart, trading panel) renders immediately; channel history streams in once the YouTube API calls complete. The trading panel is never blocked.

**BigInt serialization:** `youtubePolls.viewCount`, `likeCount`, and `markets.milestoneThreshold` are all Drizzle `bigint` columns returned as JS `BigInt`. Before passing to any component props or chart data arrays, these must be converted to `number` with `Number(bigintValue)`. Values above `Number.MAX_SAFE_INTEGER` (9 quadrillion views) are not a practical concern.

> **AGENTS.md constraint:** Before writing any Next.js code, consult `node_modules/next/dist/docs/` for v16.2.1-specific APIs. The async `params` pattern (`params: Promise<{id: string}>` with `await params`) is already in use throughout the codebase and must be followed in any new route handlers.

---

### Implementation Phases

#### Phase 1: Data Foundation

**Goal:** Persist `channelId` and `description` for new markets. Existing markets degrade gracefully (sub-sections omitted silently if data absent).

**Files changed:**

**`src/db/schema.ts`** — extend the `videoMetadata` JSONB type (TypeScript only; no DB migration needed since JSONB is schemaless):

```ts
// src/db/schema.ts (lines 104-108)
videoMetadata: jsonb("video_metadata").$type<{
  title: string;
  thumbnail: string;
  channelTitle: string;
  channelId?: string;      // NEW
  description?: string;    // NEW
}>()
```

**`src/lib/actions/admin.ts`** — two changes:

1. Add `description` to the `fields` projection on the initial `videos` API call (currently at the string that includes `snippet(title,thumbnails,channelTitle,channelId,publishedAt,categoryId)`). Add `description` to the snippet fields:

   ```
   fields=items(snippet(title,thumbnails,channelTitle,channelId,publishedAt,categoryId,description),statistics(...))
   ```

   > ⚠️ **Institutional learning** (`docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md`): The YouTube API returns HTTP 200 with partial data when a field is missing from the `fields` string. After updating the projection, add a dev-time assertion `if (!item.snippet.description) console.warn('description missing from YouTube response')` and test immediately.

2. Update the `videoMetadata` object written in `createMarket` (currently lines 299-303) to include `channelId` and `description`:

   ```ts
   videoMetadata: {
     title: metadata.title,
     thumbnail: metadata.thumbnail,
     channelTitle: metadata.channelTitle,
     channelId: metadata.channelId,          // already fetched, was discarded
     description: metadata.description ?? "", // NEW field from API
   }
   ```

**Degradation contract for existing markets:** Any market without `channelId` or `description` in `videoMetadata` will simply not render those sub-sections. No placeholder text. The `VideoStatsChart` (R1) always renders for all markets since it reads from `youtubePolls`, not `videoMetadata`.

**No backfill migration needed** for Phase 1. Admins can re-create markets to get the new fields, or a one-time admin script can be added later if needed.

---

#### Phase 2: View/Like Trajectory Chart (`VideoStatsChart`)

**Goal:** Display the video's actual view or like count over time, with the milestone target as a labeled reference line.

**`src/app/markets/[id]/page.tsx`** — add a `youtubePolls` query alongside the existing `history` and `recentTrades` fetches:

```ts
// Add after line 49 (priceSnapshots query)
const pollHistory = await db
  .select()
  .from(youtubePolls)
  .where(eq(youtubePolls.marketId, id))
  .orderBy(youtubePolls.polledAt)
  .limit(500);

// Build chart-safe data — skip rows where the relevant count is null (deleted/private video)
const statsChartData = pollHistory
  .filter(p => market.questionType === "views" ? p.viewCount !== null : p.likeCount !== null)
  .map(p => ({
    time: Math.floor(p.polledAt.getTime() / 1000), // Unix seconds, matches PriceChart pattern
    value: Number(market.questionType === "views" ? p.viewCount! : p.likeCount!),
  }));

const milestoneNumber = Number(market.milestoneThreshold); // BigInt → number
```

**`src/components/VideoStatsChart.tsx`** — new `"use client"` component modeled on `PriceChart.tsx`:

```ts
// Props
interface VideoStatsChartProps {
  data: { time: number; value: number }[];
  milestone: number;
  metricLabel: "views" | "likes";
}
```

- Uses lightweight-charts v5 `createChart` + `addSeries(AreaSeries, ...)` (same pattern as `PriceChart`)
- Y-axis formatter: human-readable counts (`1.2M`, `450K`, `12K`) — implement a `formatCount(n: number): string` helper
- **Milestone reference line:** Use lightweight-charts v5 `series.createPriceLine({ price: milestone, color: ..., lineStyle: 1, title: "Target: X views" })` after series is created
  > ⚠️ **AGENTS.md constraint:** Verify the `createPriceLine` API in `node_modules/next/dist/docs/` or the lightweight-charts v5 source — the API may differ from v4 training data
- Handle resize via `window.addEventListener('resize', ...)` (same as PriceChart)
- Height: `280px` (taller than PriceChart's 200px to show milestone gap clearly)

**Empty state:** When `data.length === 0`, render a fallback message: "Poll data not yet available — chart will appear after the first polling interval."

---

#### Phase 3: Channel History (`ChannelHistorySection`)

**Goal:** Show the channel's 10 most recent videos as thumbnail cards, cached for 1 hour.

**`src/lib/youtube.ts`** — new utility file extracting the channel video fetch pattern already present inline in `admin.ts`:

```ts
export interface ChannelVideo {
  id: string;
  title: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
}

export async function fetchChannelRecentVideos(channelId: string): Promise<ChannelVideo[]>
```

Implementation (3 fetch calls, all with `{ next: { revalidate: 3600 } }`):

1. `GET /youtube/v3/channels?id={channelId}&part=contentDetails&fields=items(contentDetails/relatedPlaylists/uploads)` → get `uploadsPlaylistId`
2. `GET /youtube/v3/playlistItems?playlistId={uploadsPlaylistId}&maxResults=10&part=contentDetails&fields=items(contentDetails/videoId)` → get `videoIds[]`
3. `GET /youtube/v3/videos?id={videoIds.join(',')}&part=snippet,statistics&fields=items(id,snippet(title,thumbnails/medium/url),statistics(viewCount,likeCount))` → get full data

Return `ChannelVideo[]` sorted by playlist order (most recent first).

> ⚠️ **Institutional learning:** Update the `fields` projection string before coding, then add a dev-time assertion to catch silent omissions. Wrap all three calls in a single `try/catch`; on any failure, return `[]` — channel history failure must never break the market page.

> ⚠️ **Quota:** Each channel history fetch costs ~3 YouTube Data API quota units. With 1-hour caching per `channelId`, the quota impact is proportional to the number of distinct channels, not page views.

**`src/components/ChannelHistorySection.tsx`** — async Server Component (no `"use client"` needed):

```ts
// Async Server Component — rendered inside <Suspense> on the market page
export async function ChannelHistorySection({ channelId }: { channelId: string }) {
  const videos = await fetchChannelRecentVideos(channelId);
  if (videos.length === 0) return null;
  return <ChannelHistoryCards videos={videos} />;
}
```

**`src/components/ChannelHistoryCards.tsx`** — pure presentational (can be Server Component):

Renders a scrollable list of cards. Each card:
- `<img>` thumbnail (`channelVideo.thumbnail`)
- Video title (truncated to 2 lines)
- View count formatted (`1.2M views`)
- Like count formatted (`45K likes`)

Cards should be horizontally scrollable on mobile (CSS `overflow-x: auto`, flex row, min-card-width ~200px).

**Suspense integration in `page.tsx`:**

```tsx
{videoMetadata?.channelId && (
  <Suspense fallback={
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Channel History</h2>
      <ChannelHistorySkeleton />
    </div>
  }>
    <ChannelHistorySection channelId={videoMetadata.channelId} />
  </Suspense>
)}
```

`ChannelHistorySkeleton` renders 4 placeholder cards (gray rounded rectangles) at the same dimensions as real cards.

**`ChannelHistorySection` must render the card container itself** so that returning `null` (empty API response) cleanly removes both the heading and the content — no orphaned heading after the skeleton resolves:

```ts
export async function ChannelHistorySection({ channelId }: { channelId: string }) {
  const videos = await fetchChannelRecentVideos(channelId);
  if (videos.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Channel History</h2>
      <ChannelHistoryCards videos={videos} />
    </div>
  );
}
```

---

#### Phase 4: Video Description (`VideoDescription`)

**Goal:** Display the stored YouTube video description with expand/collapse at 300 characters.

**`src/components/VideoDescription.tsx`** — `"use client"` component:

```ts
interface VideoDescriptionProps {
  description: string;
}
```

- If `description.length <= 300`: render full text, no toggle
- If `description.length > 300`: render first 300 chars + `...`, with a `"Show more"` button
- `"Show more"` / `"Show less"` toggle via `useState`
- Text style: `text-sm text-muted`

---

#### Phase 5: UX Reorganization

**Goal:** Add the "Video Intelligence" section to `src/app/markets/[id]/page.tsx`, placed between the video embed and the price chart.

The left column (`lg:col-span-2`) after reorganization, top to bottom:

1. YouTube `<iframe>` embed *(unchanged)*
2. **Video Intelligence section** *(new)*
   - Description card — rendered only if `videoMetadata?.description` is present
   - View/Like Stats Trajectory card — always rendered (empty state if no poll data)
   - Channel History card — rendered only if `videoMetadata?.channelId` is present (wrapped in Suspense)
3. Price chart *(unchanged, moved below Video Intelligence)*
4. Market Details *(unchanged)*
5. Recent Trades *(unchanged)*

> **Mobile note:** The trading panel in the right column (`lg:col-span-1`) currently stacks below the left column on mobile. Adding the Video Intelligence section above the price chart pushes the trading panel further down on mobile. This is a known UX tradeoff accepted in scope. A sticky bottom trading bar for mobile is explicitly out of scope for this plan.

---

## Alternative Approaches Considered

**Store channel history in DB table** — would eliminate YouTube API quota cost entirely and allow fast page loads with no external calls. Rejected for now: adds schema complexity, requires a new cron or backfill, and the 1-hour Next.js fetch cache achieves the same per-user outcome with less infrastructure.

**Reuse `PriceChart` for stats trajectory** — `PriceChart` has a hardcoded probability formatter (0–1 → percentage) and no reference line support. Extending it to support raw counts and a milestone line would make the component significantly more complex. A dedicated `VideoStatsChart` is simpler overall.

**Tab-based layout (Description / Stats / Channel History)** — deferred per requirements doc. Stacked sections are simpler to implement and scroll naturally. Tabs can be added later if the section becomes too long.

---

## System-Wide Impact

### Interaction Graph

`page.tsx` server render → sequential DB queries (market, recentTrades, priceSnapshots, **youtubePolls**) → synchronous render of all sections except `ChannelHistorySection` → streaming `ChannelHistorySection` resolve → YouTube API calls (3 serial, cached) → client hydration of `VideoStatsChart`, `VideoDescription`, `TradePanel`.

### Error & Failure Propagation

- `fetchChannelRecentVideos` failure: caught in `try/catch`, returns `[]`, `ChannelHistorySection` returns `null`. No error surface to the user.
- `youtubePolls` query failure: propagates as a server render error (same as all other DB queries on the page). No special handling needed beyond the existing page-level error boundary.
- `videoMetadata` null: all three new sub-sections check for their required field before rendering; a null `videoMetadata` results in all three being silently omitted.

### State Lifecycle Risks

No new write paths introduced. All new data flows are read-only at the market detail page level. `createMarket` write is additive — new fields written to existing JSONB column with no constraints or unique indexes.

### API Surface Parity

`GET /api/markets/[id]` currently returns `videoMetadata` but not `youtubePolls` data. If this API route is used by other consumers (e.g., a future mobile client), it should also be updated to include the polls time series. This is out of scope for now but flagged.

### Integration Test Scenarios

1. **New market (has channelId + description):** All three sub-sections render. Stats chart appears after first poll. Channel history loads after Suspense resolves.
2. **Old market (no channelId/description):** Stats chart renders (reads from youtubePolls). Description and channel history sections are entirely absent — no broken UI.
3. **Market with null poll data (deleted/private video):** Stats chart renders empty state message. No chart errors from null `viewCount`/`likeCount` values.
4. **YouTube API timeout during channel history fetch:** `fetchChannelRecentVideos` returns `[]`. `ChannelHistorySection` returns `null`. Page renders without the section.
5. **Market with only one poll row:** `VideoStatsChart` renders a single data point. Not a crash condition for lightweight-charts. Milestone line is still visible.

---

## Acceptance Criteria

### Functional

- [ ] **R1** — A view/like count chart appears on every market detail page, using data from `youtubePolls`. The milestone target is rendered as a labeled reference line on the chart. (see origin: requirements R1)
- [ ] **R1** — Chart correctly shows `viewCount` for `questionType = "views"` markets and `likeCount` for `questionType = "likes"` markets.
- [ ] **R1** — Chart shows an empty-state message (not an error) when `youtubePolls` has no rows for the market.
- [ ] **R1** — Rows where the relevant count is `null` (deleted/private video) are skipped without crashing the chart.
- [ ] **R2** — The YouTube video description is displayed for markets where `videoMetadata.description` is present. (see origin: requirements R2)
- [ ] **R2** — Descriptions longer than 300 characters are truncated with a "Show more" / "Show less" toggle.
- [ ] **R2** — The description section is entirely absent (no placeholder) for markets without a stored description.
- [ ] **R3** — The channel history section renders 10 video cards (thumbnail, title, view count, like count) for markets where `videoMetadata.channelId` is present. (see origin: requirements R3)
- [ ] **R3** — The channel history section is absent (no placeholder) when `channelId` is not stored.
- [ ] **R3** — A loading skeleton renders while `ChannelHistorySection` awaits the YouTube API.
- [ ] **R3** — Channel history section is absent (not an error) when `fetchChannelRecentVideos` returns an empty array.
- [ ] **R4** — The Video Intelligence section appears above the price chart in the left column. (see origin: requirements R4)
- [ ] **R4** — The trading panel in the right column is not affected by the new sections.
- [ ] New markets created after this change have `channelId` and `description` persisted in `videoMetadata`.
- [ ] Existing markets without these fields render without broken UI.

### Non-Functional

- [ ] TypeScript compiles cleanly with `strict: true`.
- [ ] `BigInt` values from Drizzle are converted to `number` before any component prop or JSON serialization.
- [ ] Channel history is cached via Next.js fetch cache (`revalidate: 3600`) — no duplicate YouTube API calls within the cache window for the same `channelId`.
- [ ] `await params` used in any new API route handlers (Next.js 16.2.1 requirement).
- [ ] Existing Vitest tests pass (`npm run test`).

### Quality Gates

- [ ] `fetchChannelRecentVideos` failure does not surface as a visible error on the market page.
- [ ] `VideoStatsChart` renders without error when `data` is an empty array.
- [ ] `VideoDescription` renders without error when `description` is an empty string.

---

## Dependencies & Prerequisites

- Phase 1 (data foundation) is a hard prerequisite for Phase 2 description display, Phase 3 (channel history), and Phase 4 (video description component) — all three require `channelId` or `description` to be stored first.
- The `VideoStatsChart` (Phase 2 chart), `ChannelHistorySection` (Phase 3), and `VideoDescription` (Phase 4) are independent of each other and can be developed in parallel after Phase 1.
- Phase 5 (UX reorganization) should be the last step — assemble all components on the page once they exist individually.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| YouTube API `fields` update silently drops `description` | Medium | Dev-time assertion after updating projection string (per `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md`) |
| `drizzle-kit` migration commands fail without `.env.local` | N/A for Phase 1 | Phase 1 is a TypeScript-only JSONB type change — no migration commands needed. If a future migration is added, confirm `drizzle.config.ts` has `config({ path: ".env.local" })` as first line (per `docs/solutions/integration-issues/drizzle-kit-env-local-configuration.md`) |
| lightweight-charts v5 `createPriceLine` API differs from training data | Medium | Consult `node_modules/next/dist/docs/` per AGENTS.md constraint before writing component |
| BigInt serialization error passing poll data to client components | High (likely) | Convert to `number` on the server before passing to `VideoStatsChart` props |
| YouTube API quota exceeded by channel history fetches | Low (with cache) | 1-hour Next.js fetch cache per channelId limits calls to ~24/day per channel regardless of page views |

---

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-23-market-detail-video-intelligence-requirements.md](../brainstorms/2026-03-23-market-detail-video-intelligence-requirements.md)
  - Key decisions carried forward: (1) channel history fetched live from YouTube API with 1-hour cache, (2) `youtubePolls` data displayed as trajectory chart with milestone reference line, (3) card list UI for channel history (thumbnail + view/like counts)

### Internal References

- Market detail page: `src/app/markets/[id]/page.tsx`
- Existing `PriceChart` (pattern to follow): `src/components/PriceChart.tsx`
- YouTube API calls (existing pattern): `src/lib/actions/admin.ts` lines 87-232
- `videoMetadata` type definition: `src/db/schema.ts` lines 104-108
- `youtubePolls` schema: `src/db/schema.ts` lines 208-225
- `TradePanel` (must not be disrupted): `src/components/TradePanel.tsx`

### Institutional Learnings Applied

- `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — YouTube `fields` projection silent failures; parallel fetch + `try/catch` pattern
- `docs/solutions/integration-issues/drizzle-kit-env-local-configuration.md` — `.env.local` must be loaded in `drizzle.config.ts` before any migration commands
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — BigInt handling, date normalization with `Date.UTC`
