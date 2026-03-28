---
status: pending
priority: p2
issue_id: "078"
tags: [code-review, performance, api]
dependencies: []
---

# `GET /api/admin/video-stats` uses `cache: "no-store"` — YouTube quota burned on every call

## Problem Statement

`GET /api/admin/video-stats` uses `cache: "no-store"` on every YouTube API fetch. Every call consumes a YouTube Data API v3 quota unit. With the daily quota of 10,000 units, and each Phase 2 `generateMarketSuggestion` consuming 3 units (channels + playlistItems + videos), an automated agent could exhaust the daily quota in a few thousand requests. When quota is exhausted, the poll-youtube cron job and market resolution pipeline also fail for the rest of the day.

`docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` explicitly documents quota cost awareness as a required consideration for any YouTube API proxy.

## Proposed Solution

**Option A (Recommended for video-stats):** Add a short Next.js route-level cache:
```typescript
// Replace:
{ cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }

// With:
{ next: { revalidate: 300 }, signal: AbortSignal.timeout(YT_TIMEOUT_MS) }
// 5-minute revalidation — freshness is sufficient for market creation decisions
```

**Option B (Recommended for channel analytics in generateMarketSuggestion):** Add per-channel in-memory or Vercel KV cache:
```typescript
// Cache channel stats by channelId for 10 minutes:
const cacheKey = `channel:${channelId}`;
const cached = channelCache.get(cacheKey);
if (cached && Date.now() - cached.ts < 600_000) return cached.data;
// ... fetch ...
channelCache.set(cacheKey, { ts: Date.now(), data: result });
```

A simple `Map` with TTL works for a single-instance deployment. Vercel KV (or Upstash Redis) is needed for multi-instance.

- **Effort**: Small (Next.js revalidate) to Medium (KV cache for channel analytics)
- **Risk**: Low — cache is read-only; worst case is slightly stale view counts

## Acceptance Criteria

- [ ] `GET /api/admin/video-stats` does not make a live YouTube API call when the same `videoId` was fetched within the last 5 minutes
- [ ] `generateMarketSuggestion` does not re-fetch channel analytics for the same `channelId` within a configurable window
- [ ] Quota exhaustion in the video-stats/market-suggestion path does not block the poll-youtube cron job (separate quota path)

## Work Log

- 2026-03-27: Identified during `/ce:review` — performance-oracle (P1 — reclassified P2 for non-correctness), security-sentinel (P2-7), learnings-researcher (quota cost awareness pattern)
