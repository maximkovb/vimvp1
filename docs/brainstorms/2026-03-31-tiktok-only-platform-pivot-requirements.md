---
date: 2026-03-31
topic: tiktok-only-platform-pivot
---

# TikTok-Only Platform Pivot

## Problem Frame

Virality was built as a YouTube prediction market but has been expanding to TikTok. The product is now pivoting to be **strictly a TikTok video prediction platform**. Every YouTube trace — schema tables, service code, cron jobs, UI labels, conditional branching, and channel history components — must be removed. TikWM is already integrated and working as the data source. This is a clean-slate pivot, not a multi-platform expansion: the DB is test-only, so no migration of existing data is needed.

## Requirements

- **R1.** The `youtube_polls` table, `platform` enum, and `platform` column are removed from the database schema in a single clean migration. All schema code references to YouTube (table, relations, enum) are deleted.
- **R2.** `src/lib/youtube.ts` and `src/app/api/cron/poll-youtube/route.ts` are deleted. No YouTube API calls exist anywhere in the codebase.
- **R3.** `ChannelHistorySection` and `ChannelHistoryCards` components are deleted. The market detail page no longer renders a channel history section.
- **R4.** The oracle (`src/lib/oracle.ts`) resolves markets exclusively from `tiktokPolls` — no platform dispatch, no platform conditionals.
- **R5.** Admin market creation (`src/lib/actions/admin.ts`, admin pages) only accepts TikTok URLs. YouTube URL detection and the YouTube fetch path are removed. The URL field label and placeholder reflect TikTok only.
- **R6.** All UI copy referencing YouTube — labels, placeholders, help text, error messages — is updated to TikTok equivalents.
- **R7.** The market detail page (`/markets/[id]`) is updated to always render the TikTok embed, with a layout that emphasizes vertical video framing. The page adopts TikTok-native visual language: creator handle display, engagement metrics (views, likes, comments, shares) styled inline with the embed, and a vertical-first content flow.
- **R8.** The `tikapiPostId` column name in the schema is renamed to a platform-agnostic name (e.g., `platformVideoId` or simply left as-is if no migration cost is acceptable — decision deferred to planning).
- **R9.** `YOUTUBE_THUMBNAIL_RE` and any YouTube-related constants are removed from `src/lib/constants.ts`. Thumbnail validation uses only `TIKTOK_THUMBNAIL_RE`.
- **R10.** Market suggestion (`src/lib/services/marketSuggestion.ts`) and calibration (`src/lib/calibration.ts`) are checked and any YouTube-specific logic or copy is updated to TikTok.
- **R11.** `src/app/page.tsx` and `src/app/layout.tsx` have any YouTube branding or copy replaced with TikTok equivalents.

## Success Criteria

- Zero occurrences of "youtube" or "YouTube" in `src/` (case-insensitive grep returns no results).
- Admin can create a TikTok market from a `tiktok.com/@user/video/...` URL with no errors; YouTube URLs are rejected with a clear error.
- Market detail page renders the TikTok embed with vertical layout and creator/engagement metadata visible.
- `GET /api/cron/poll-tiktok` polls successfully and inserts rows into `tiktok_polls`.
- Oracle resolves a TikTok market without platform branching.
- TypeScript build passes with no errors.

## Scope Boundaries

- No new features beyond the pivot — existing LMSR trading, contract buying, view count charts, portfolios, and leaderboard are preserved as-is.
- No changes to auth, economy, payout, or non-market pages unless they contain YouTube copy.
- "instagram" value in the enum is dropped along with "youtube" — the enum itself is removed entirely.
- `tikapiPostId` column rename is a planning decision: if it requires a separate migration and adds friction, keep the name as-is and rename in a follow-up.

## Key Decisions

- **Remove `platform` column entirely**: The schema has no platform enum or column. All market records are implicitly TikTok. This eliminates all conditional branching in oracle, market page, and admin code. If a new platform is added later, it's an additive migration.
- **DB is test-only**: No data preservation or migration of existing YouTube markets is needed. Drop tables cleanly.
- **UI depth**: Functional copy swap throughout, plus TikTok-native visual treatment specifically on the market detail page (vertical embed, creator context, engagement stats layout).

## Dependencies / Assumptions

- TikWM integration in `src/lib/tiktok.ts` is already complete and working — no changes needed there.
- `tiktok_polls` table already exists in the schema — it stays as-is.
- `tikapiPostId` column is kept under its current name unless planning determines a rename is low-cost.

## Outstanding Questions

### Resolve Before Planning
_(none — all product decisions resolved above)_

### Deferred to Planning

- [Affects R1, R8][Technical] Should `tikapiPostId` be renamed in the same migration, or deferred? Assess migration cost.
- [Affects R7][Needs research] What specific TikTok-native visual patterns should the market detail page adopt? Review existing `TikTokEmbed` component sizing and current `MarketLiveData` layout before designing the updated page.
- [Affects R2][Technical] Confirm `youtube.ts` is not imported anywhere outside of files being deleted before removing it.
- [Affects R10][Technical] Grep `calibration.ts` and `marketSuggestion.ts` for YouTube-specific logic vs. YouTube-only copy — determine if logic changes are needed or only text replacements.

## Next Steps

→ `/ce:plan` for structured implementation planning
