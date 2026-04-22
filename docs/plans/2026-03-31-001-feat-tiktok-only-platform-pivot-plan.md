---
title: TikTok-Only Platform Pivot — Remove All YouTube, Adapt UI for TikTok
type: feat
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-tiktok-only-platform-pivot-requirements.md
---

# TikTok-Only Platform Pivot — Remove All YouTube, Adapt UI for TikTok

## Overview

Virality is becoming a **strictly TikTok video prediction platform**. Every YouTube artifact — tables, service files, cron jobs, constants, UI labels, conditional branches, and channel history components — is removed in one focused pass. TikWM is already integrated and working. The DB is test-only, so no data preservation is needed. The market detail page gets a TikTok-native visual treatment: vertical embed, creator context, and inline engagement metrics. All other pages receive copy-only updates.

Key decisions from the origin brainstorm (see `docs/brainstorms/2026-03-31-tiktok-only-platform-pivot-requirements.md`):
- **Remove `platform` column and enum entirely** from the schema — no more branching, all markets are implicitly TikTok
- **Drop `youtube_polls` table** — clean migration, no data to preserve
- **`tikapiPostId` column kept as-is** — rename adds migration cost with no user value
- **UI depth**: functional copy swap everywhere; TikTok-native visual treatment on the market detail page specifically

---

## Problem Statement

20 files reference YouTube. The platform column defaults to `"youtube"` in the DB. The oracle branches on platform. The admin form accepts YouTube URLs. The market detail page conditionally renders a 16:9 YouTube iframe. The cron polls YouTube. None of this works or should exist once we are TikTok-only.

---

## Proposed Solution

Five sequential phases:

1. **Schema migration** — drop `youtube_polls`, remove `platform` column and `platformEnum`
2. **Delete YouTube-only files** — `youtube.ts`, `poll-youtube` cron, `ChannelHistorySection`, `ChannelHistoryCards`
3. **Simplify service/API layer** — remove all YouTube code paths from oracle, admin actions, market suggestion, constants, API routes
4. **UI copy + functional updates** — admin pages, home page, layout, `next.config.ts`
5. **Market detail page redesign** — TikTok-native vertical layout, creator/engagement context

---

## Technical Approach

### Pre-Flight Checks

Before touching any code:

1. Verify `drizzle.config.ts` starts with `dotenv.config({ path: ".env.local" })` before `defineConfig` — this is a known gotcha; without it every migration command fails with a misleading "connection url required" error (see `docs/solutions/integration-issues/drizzle-kit-env-local-configuration.md`).

   ```bash
   head -5 drizzle.config.ts
   ```

2. Confirm no real YouTube markets exist:
   ```bash
   # Run against your Neon DB to confirm
   # SELECT COUNT(*) FROM markets WHERE platform = 'youtube';
   ```

---

### Phase 1 — Database Schema Migration

**Files: `src/db/schema.ts`**

#### 1a. Remove `platformEnum` and `platform` column from `markets`

```ts
// DELETE:
export const platformEnum = pgEnum("platform", ["youtube", "tiktok", "instagram"]);

// In markets table, DELETE these lines:
platform: platformEnum("platform").default("youtube").notNull(),
tikapiPostId: text("tikapi_post_id"),   // KEEP — just remove platform
```

Wait — `tikapiPostId` is kept per the origin decision. Only `platform` column is dropped.

```ts
// markets table — final state (remove platform line only):
videoId: text("video_id").notNull(),
tikapiPostId: text("tikapi_post_id"),
// platform: GONE
```

#### 1b. Remove `youtubePolls` table, relations, and `marketsRelations` entry

```ts
// DELETE entire block:
export const youtubePolls = pgTable("youtube_polls", { ... });
export const youtubePollsRelations = relations(youtubePolls, ...);

// In marketsRelations, DELETE:
youtubePolls: many(youtubePolls),
```

#### 1c. Update `src/types/market.ts`

Remove `platform` field from `MarketData` type. Remove `tikapiPostId` if it's not needed on the frontend (verify callers), or keep it as `tikapiPostId?: string`. Remove `platform: "youtube" | "tiktok" | "instagram"` — the type no longer carries platform.

#### 1d. Generate and run migration

```bash
# Generate a reviewable SQL migration file
npm run db:generate

# Review the generated migration — confirm it includes:
# DROP TABLE youtube_polls (and its indexes)
# ALTER TABLE markets DROP COLUMN platform
# DROP TYPE platform

# Apply
npm run db:migrate
```

> ⚠️ Drizzle will NOT auto-drop tables/columns on `db:push`. Always use `db:generate` + `db:migrate` for destructive changes so there is a reviewable `.sql` file.

---

### Phase 2 — Delete YouTube-Only Files

Delete these files entirely — they have no callers after Phase 3+4 updates:

| File | Why |
|---|---|
| `src/lib/youtube.ts` | YouTube Data API client — `extractVideoId`, `fetchChannelRecentVideos`, all YouTube types |
| `src/app/api/cron/poll-youtube/route.ts` | YouTube polling cron — entire file |
| `src/components/ChannelHistorySection.tsx` | YouTube channel history — no TikTok equivalent |
| `src/components/ChannelHistoryCards.tsx` | YouTube channel cards — depends on `ChannelVideo` type from `youtube.ts` |

Also remove `YOUTUBE_API_KEY` from:
- `.env.local` (if present)
- `.env.local.example`
- Vercel environment dashboard

---

### Phase 3 — Simplify Service & API Layer

#### 3a. `src/lib/constants.ts`

Delete all YouTube constants:

```ts
// DELETE:
export const YOUTUBE_THUMBNAIL_RE = ...
export const YOUTUBE_CHANNEL_ID_RE = ...
export const YOUTUBE_API_BASE = ...
export const YT_TIMEOUT_MS = ...
```

Keep: `TIKTOK_THUMBNAIL_RE`, `TIKTOK_VIDEO_ID_RE`

#### 3b. `src/lib/oracle.ts`

Remove the `fetchYouTubeStats` function (it's dead code — not called externally) and its `YouTubeStatsResponse` interface. Simplify `resolveMarket` to use `tiktokPolls` unconditionally:

```ts
// BEFORE (platform dispatch):
if (market.platform === "tiktok") {
  [poll] = await db.select().from(tiktokPolls)...
} else {
  [poll] = await db.select().from(youtubePolls)...
}

// AFTER (unconditional):
const [poll] = await db
  .select()
  .from(tiktokPolls)
  .where(eq(tiktokPolls.marketId, marketId))
  .orderBy(desc(tiktokPolls.polledAt))
  .limit(1);
```

Remove imports: `youtubePolls`, `YOUTUBE_API_BASE`, `YT_TIMEOUT_MS`

#### 3c. `src/lib/actions/admin.ts`

- Delete `YTVideoItem`, `YTListResponse` interfaces
- Delete imports: `YOUTUBE_THUMBNAIL_RE`, `YOUTUBE_API_BASE`, `YT_TIMEOUT_MS`, `extractVideoId`
- **`fetchVideoStats()`**: Delete the YouTube path entirely. The function is now TikTok-only — no `isTikTokUrl()` detection needed, just call `extractTikTokVideoId` + `fetchTikTokStatsById` directly.
- **`generateMarketSuggestion()`**: Remove the `YOUTUBE_API_KEY` lookup and pass empty string or remove the `apiKey` param once `marketSuggestion.ts` no longer needs it.
- **`createMarket()`**:
  - Remove `detectedPlatform` variable (was `isTikTokUrl(videoUrl) ? "tiktok" : "youtube"`)
  - Remove the YouTube thumbnail validation branch — use `TIKTOK_THUMBNAIL_RE` directly
  - Remove the `youtubePolls` insert branch for the initial poll — `tiktokPolls` always
  - Remove error message copy referencing "YouTube"
- **`createTestMarket()`**: Same simplifications — delete the YouTube API call block, `YOUTUBE_API_KEY` check, and `youtubePolls` insert branch
- Error message on invalid URL: `"Invalid TikTok URL — paste a full tiktok.com/@user/video/... URL"`

#### 3d. `src/lib/services/marketSuggestion.ts`

The function currently has a TikTok early-return at lines 121–132, then falls through to a long YouTube channel analytics path. After the pivot:

- Delete everything after the TikTok early-return (the entire YouTube try/catch block)
- The TikTok path becomes the entire function body
- Delete `apiKey` parameter — no longer needed
- Delete imports: `YOUTUBE_CHANNEL_ID_RE`, `YOUTUBE_API_BASE`, `YT_TIMEOUT_MS`
- Delete local constants: `YOUTUBE_UPLOADS_PLAYLIST_RE`, `channelCache`, `CHANNEL_CACHE_TTL_MS`
- Delete YouTube API interfaces: `YTChannelItem`, `YTPlaylistItem`, `YTStatsItem`, `YTListResponse`
- Simplify `MarketSuggestionInput.platform` from `"youtube" | "tiktok"` to `"tiktok"` (or remove if field is no longer needed)

#### 3e. `src/app/api/admin/video-stats/route.ts`

Delete the YouTube path (currently lines 67–111). The route becomes TikTok-only:

```ts
// Remove imports: YOUTUBE_API_BASE, YT_TIMEOUT_MS, extractVideoId
// Remove the YouTube path block

// Non-TikTok URL fallthrough should now return 400:
return Response.json({ error: "Only TikTok URLs are supported" }, { status: 400 });
```

Update JSDoc to remove YouTube references.

#### 3f. `src/app/api/admin/market-suggestion/route.ts`

- Delete `YouTubeSuggestionSchema`
- Replace the `discriminatedUnion` of YouTube+TikTok with a single `TikTokSuggestionSchema` (rename it to `MarketSuggestionSchema`)
- Delete the YouTube branch in the handler
- Remove the `apiKey` argument from `computeMarketSuggestion` call
- Update JSDoc to TikTok-only

#### 3g. `src/app/api/markets/route.ts`

Pre-existing bug fix + YouTube removal:

```ts
// DELETE:
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

// Change:
platform: z.enum(["youtube", "tiktok"]).default("youtube")
// TO:
platform: z.literal("tiktok").default("tiktok")

// Remove YouTube CDN from thumbnail validation:
// Only TIKTOK_THUMBNAIL_RE / tiktokcdn.com pattern

// Remove YouTube branch from superRefine videoId check
```

#### 3h. `src/app/api/markets/[id]/route.ts` — Fix Pre-existing Bug

This route always queries `youtubePolls` regardless of platform (YouTube markets would return data; TikTok markets would silently return empty poll history to API consumers):

```ts
// BEFORE (bug):
import { youtubePolls } from "@/db/schema";
// ...unconditional youtubePolls query

// AFTER:
import { tiktokPolls } from "@/db/schema";
// ...unconditional tiktokPolls query
```

#### 3i. `src/lib/calibration.ts`

No logic changes. Update the `HORIZON_FRACTION` comment from YouTube Shorts velocity references to TikTok video accumulation patterns. The `0.55 / 0.80 / 1.00` constants should be flagged for empirical re-tuning based on TikTok data once the platform accumulates enough resolved markets — add a TODO comment.

---

### Phase 4 — UI Copy & Functional Updates

#### 4a. `src/app/admin/markets/new/page.tsx`

- Change URL field label: `"Video URL (YouTube or TikTok)"` → `"TikTok Video URL"`
- Change placeholder: `"https://youtube.com/shorts/... or ..."` → `"https://www.tiktok.com/@creator/video/..."`
- **Remove Phase 2 suggestion pipeline**: Delete the `if (statsResult.platform !== "tiktok" && statsResult.channelId)` block (lines 172–214) and associated state (`suggestion`, `isGeneratingSuggestion`, `generateMarketSuggestion` handler, `channelAvgViews` hidden input)
- The `MarketStatsPanel` will always show null for `subscriberCount` and `channelAvgViews` — simplify or hide those fields in the panel if they were YouTube-only

#### 4b. `src/app/admin/markets/quick/page.tsx`

- Remove `import { extractVideoId } from "@/lib/youtube"`
- Replace `extractVideoId(videoUrl.trim())` validation with `isTikTokUrl(videoUrl.trim())` (import from `@/lib/tiktok`)
- Step heading: `"Step 1 — Paste YouTube URL"` → `"Step 1 — Paste TikTok URL"`
- Placeholder: `"https://youtube.com/watch?v=..."` → `"https://www.tiktok.com/@creator/video/..."`

#### 4c. `src/app/page.tsx`

```tsx
// Hero headline:
// BEFORE: "Predict YouTube's <span>Next Hit</span>"
// AFTER:  "Predict TikTok's <span>Next Hit</span>"

// Hero paragraph:
// BEFORE: "Bet virtual currency on whether YouTube videos will hit..."
// AFTER:  "Bet virtual currency on whether TikTok videos will hit..."
```

#### 4d. `src/app/layout.tsx`

```ts
// BEFORE:
title: "Virality — Predict YouTube's Next Hit"
description: "Bet virtual currency on YouTube video performance. Will it go viral?"

// AFTER:
title: "Virality — Predict TikTok's Next Hit"
description: "Bet virtual currency on TikTok video performance. Will it go viral?"
```

#### 4e. `next.config.ts`

```ts
// images.remotePatterns — REMOVE:
{ protocol: "https", hostname: "i.ytimg.com" },
{ protocol: "https", hostname: "img.youtube.com" },

// CSP img-src — REMOVE:
https://i.ytimg.com https://img.youtube.com

// CSP frame-src — REMOVE:
https://www.youtube.com
```

---

### Phase 5 — Market Detail Page: TikTok-Native Design

**File: `src/app/markets/[id]/page.tsx`**

#### 5a. Fix poll query and remove YouTube conditionals

```tsx
// BEFORE (platform dispatch):
market.platform === "tiktok"
  ? db.select().from(tiktokPolls)...
  : db.select().from(youtubePolls)...

// AFTER (unconditional):
db.select().from(tiktokPolls).where(eq(tiktokPolls.marketId, id))...

// Remove youtubePolls import
// Remove ChannelHistorySection import and its Suspense wrapper
```

#### 5b. Layout redesign

The current layout stacks the embed, description, and live data panel vertically. For TikTok:
- The embed is already 325px wide at 9:16 — keep this constraint but build around it intentionally
- On desktop (md+): side-by-side layout — TikTok embed + creator card on the left, trade panel + charts on the right
- On mobile: full-width vertical stack (existing behavior)

**Suggested layout structure:**

```tsx
{/* Desktop: 2-col. Mobile: stacked */}
<div className="flex flex-col md:flex-row gap-6">

  {/* LEFT COLUMN — embed + creator context */}
  <div className="flex-shrink-0 flex flex-col items-center gap-3 md:w-[340px]">
    <TikTokEmbed videoId={market.videoId} title={...} />

    {/* Creator card */}
    {videoMetadata?.channelTitle && (
      <div className="w-full bg-card border border-border rounded-xl px-4 py-3">
        <p className="text-xs text-muted">Creator</p>
        <p className="font-semibold text-sm">@{videoMetadata.channelTitle}</p>
      </div>
    )}

    {/* Engagement snapshot (latest poll data) */}
    <div className="w-full bg-card border border-border rounded-xl px-4 py-3 grid grid-cols-2 gap-y-2 text-sm">
      <div><span className="text-muted text-xs">Views</span><p className="font-medium">{latestViews}</p></div>
      <div><span className="text-muted text-xs">Likes</span><p className="font-medium">{latestLikes}</p></div>
    </div>
  </div>

  {/* RIGHT COLUMN — trade panel, charts, market info */}
  <div className="flex-1 min-w-0">
    <MarketLiveData ... />
  </div>
</div>
```

#### 5c. TikTok-native visual accents

- The market's YES/NO buttons and price indicators may use a subtle brand-aware accent — the existing theme colors should suffice; no hard-coded TikTok red is required
- `@` prefix before creator handle in the creator card
- Engagement metrics use short-form formatting via existing `src/lib/format.ts` (`formatNumber` or equivalent)
- Remove the `About This Video` description card if it is typically empty for TikTok (TikTok captions are short; this section looks empty in practice) — or conditionally hide when description is < 20 chars

---

## System-Wide Impact

### Interaction Graph

`admin createMarket` → `fetchTikTokStatsById` (TikWM) → insert `tiktokPolls` initial row → market created

`poll-tiktok cron` → `fetchTikTokStatsById` → insert `tiktokPolls` row (runs on all active markets — no platform filter needed anymore)

`resolve-markets cron` → `resolveMarket` (oracle) → reads `tiktokPolls` unconditionally → LMSR payout → `positions` + `coinTransactions`

`market detail page` → query `tiktokPolls` unconditionally → render `TikTokEmbed` always

### Error & Failure Propagation

| Error | Behavior |
|---|---|
| Non-TikTok URL pasted in admin | `fetchVideoStats` returns `{ error: "Invalid TikTok URL" }` — same pattern as before |
| TikWM down during market creation | `fetchTikTokStatsById` throws → server action returns `{ error: "..." }` → admin form shows error |
| Deleted/private video at resolution | Oracle reads latest `tiktokPolls` row; if null counts, market stays active until next poll — existing behavior |

### State Lifecycle Risks

- The `platform` column is dropped from the DB. Any in-flight server action that reads `market.platform` after Phase 1 migration but before Phase 3 code deploy will fail TypeScript-side. **Deploy Phase 1 migration and all code changes together** — do not split across deploys.
- `tikapiPostId` column stays in the DB — no breakage.

### API Surface Parity

After the pivot:
- `GET /api/markets` — returns `tiktok`-only markets (platform field gone from response)
- `GET /api/markets/[id]` — poll history always from `tiktokPolls` (bug fixed)
- `POST /api/admin/video-stats` — TikTok-only
- `POST /api/admin/market-suggestion` — TikTok-only
- `GET /api/cron/poll-tiktok` — unchanged (already TikTok-only)
- `GET /api/cron/poll-youtube` — **deleted**

### Integration Test Scenarios

1. **Admin creates a market from a TikTok URL** → stats returned, market saved with `tikapiPostId` populated, TikTok embed renders on detail page
2. **Admin pastes a YouTube URL** → rejected with a clear "Only TikTok URLs" error
3. **`poll-tiktok` cron runs** → inserts `tiktokPolls` rows for all active markets; no platform filter needed
4. **`resolve-markets` cron resolves a market** → oracle reads `tiktokPolls` unconditionally, no platform check
5. **Market detail page loads** → TikTok embed renders, `VideoStatsChart` shows poll history from `tiktokPolls`, no channel history section

---

## Acceptance Criteria

- [ ] `grep -ri "youtube" src/` returns zero matches after the pivot
- [ ] `platform` column and `platformEnum` no longer exist in `src/db/schema.ts`
- [ ] `youtube_polls` table dropped; migration file is in `drizzle/migrations/`
- [ ] `src/lib/youtube.ts` deleted; `src/app/api/cron/poll-youtube/route.ts` deleted
- [ ] `ChannelHistorySection.tsx` and `ChannelHistoryCards.tsx` deleted
- [ ] Admin panel accepts `https://www.tiktok.com/@user/video/...` and returns stats without errors
- [ ] Admin panel rejects YouTube URLs with `"Only TikTok URLs are supported"` (or equivalent)
- [ ] `GET /api/cron/poll-tiktok` returns `{ ok: true, polled: N }` for active markets
- [ ] Oracle resolves a TikTok market using `tiktokPolls` — no platform branching in `resolveMarket`
- [ ] Market detail page renders TikTok embed at 9:16 aspect ratio
- [ ] Market detail page shows creator handle and latest engagement metrics
- [ ] Market detail page has no channel history section
- [ ] `next.config.ts` has no `ytimg.com` or `youtube.com` entries
- [ ] `npm run build` passes with no TypeScript errors

---

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| `drizzle.config.ts` missing dotenv config | Verify `head -5 drizzle.config.ts` before running migrations. This is a known gotcha (see solutions doc). |
| Dropping `platform` column in DB while old code is deployed | Deploy schema migration + all code changes atomically. No split deploys. |
| `tikapiPostId` name is confusing post-pivot | Accepted tradeoff — rename adds migration cost. Add a code comment: `// stores the canonical TikTok video ID from TikWM` |
| `HORIZON_FRACTION` calibrated for YouTube Shorts, not TikTok | Comment updated; add TODO for empirical re-tuning once TikTok market data accumulates |
| `marketSuggestion` no longer fetches channel analytics | The TikTok path already generates algorithmic suggestions without channel data. This is the intended behavior. |
| Admin `new/page.tsx` Phase 2 suggestion block gated on `platform !== "tiktok"` | Removing it is safe — it was already dead code for all TikTok markets |

---

## Implementation Phases — Files Changed Summary

### Phase 1 — DB Migration
| File | Change |
|---|---|
| `src/db/schema.ts` | Remove `platformEnum`, remove `platform` column from `markets`, remove `youtubePolls` table + relation |
| `src/types/market.ts` | Remove `platform` field |
| `drizzle/migrations/*.sql` | Generated migration: DROP TABLE youtube_polls, ALTER TABLE markets DROP COLUMN platform, DROP TYPE platform |

### Phase 2 — File Deletions
| File | Change |
|---|---|
| `src/lib/youtube.ts` | **DELETE** |
| `src/app/api/cron/poll-youtube/route.ts` | **DELETE** |
| `src/components/ChannelHistorySection.tsx` | **DELETE** |
| `src/components/ChannelHistoryCards.tsx` | **DELETE** |

### Phase 3 — Service & API Layer
| File | Change |
|---|---|
| `src/lib/constants.ts` | Remove 4 YouTube constants |
| `src/lib/oracle.ts` | Remove `fetchYouTubeStats`, unconditional `tiktokPolls` in `resolveMarket` |
| `src/lib/actions/admin.ts` | Remove YouTube paths in `fetchVideoStats`, `generateMarketSuggestion`, `createMarket`, `createTestMarket` |
| `src/lib/services/marketSuggestion.ts` | Remove YouTube channel analytics path; remove `apiKey` param |
| `src/lib/calibration.ts` | Update comment, add re-tuning TODO |
| `src/app/api/admin/video-stats/route.ts` | Delete YouTube path |
| `src/app/api/admin/market-suggestion/route.ts` | Delete `YouTubeSuggestionSchema`; TikTok-only |
| `src/app/api/markets/route.ts` | Remove `YOUTUBE_VIDEO_ID_RE`, simplify platform validation |
| `src/app/api/markets/[id]/route.ts` | Fix bug: replace `youtubePolls` with `tiktokPolls` |

### Phase 4 — UI Copy & Config
| File | Change |
|---|---|
| `src/app/admin/markets/new/page.tsx` | Update label/placeholder; remove Phase 2 YouTube suggestion pipeline |
| `src/app/admin/markets/quick/page.tsx` | Replace `extractVideoId` with TikTok validation; update copy |
| `src/app/page.tsx` | Replace "YouTube" with "TikTok" in hero |
| `src/app/layout.tsx` | Update `<title>` and meta description |
| `next.config.ts` | Remove YouTube CDN from `remotePatterns` and CSP headers |

### Phase 5 — Market Detail Page Redesign
| File | Change |
|---|---|
| `src/app/markets/[id]/page.tsx` | Remove YouTube iframe + channel history; unconditional `tiktokPolls`; side-by-side desktop layout with creator card + engagement metrics |

---

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-31-tiktok-only-platform-pivot-requirements.md](../brainstorms/2026-03-31-tiktok-only-platform-pivot-requirements.md)
  - Key decisions carried forward: (1) remove `platform` column + enum entirely, (2) drop `youtube_polls` clean — test data only, (3) market detail page gets TikTok-native vertical layout

### Institutional Learnings
- `docs/solutions/integration-issues/drizzle-kit-env-local-configuration.md` — dotenv must be in `drizzle.config.ts` before `defineConfig`; verify before running migrations
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — Drizzle won't auto-drop tables; always use `db:generate` + `db:migrate` for destructive changes; composite index must also be dropped
- `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — maps all YouTube call sites in `admin.ts`; `contract.ts` and `prediction.ts` are platform-agnostic and need no changes
- `docs/solutions/logic-errors/llm-contract-calibration-bias-fix.md` — calibration layer is platform-agnostic; reusable without changes

### Internal References
- `src/lib/tiktok.ts` — TikWM integration already complete; all callers preserved
- `src/app/api/cron/poll-tiktok/route.ts` — TikTok cron already correct; no changes needed
- `src/components/TikTokEmbed.tsx` — existing 9:16 embed component; used in Phase 5 layout
- `src/lib/format.ts` — use existing number formatters for engagement metrics display
