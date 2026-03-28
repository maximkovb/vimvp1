---
status: pending
priority: p2
issue_id: "076"
tags: [code-review, architecture, quality]
dependencies: ["070"]
---

# `extractVideoId`, `YOUTUBE_API_BASE`, `YT_TIMEOUT_MS` duplicated across 3 files

## Problem Statement

Three utilities are defined independently in multiple files:
- `extractVideoId()` — verbatim in `src/lib/actions/admin.ts` (line 70) and `src/app/api/admin/video-stats/route.ts` (line 7)
- `YOUTUBE_API_BASE` — in `admin.ts` (line 25), `video-stats/route.ts` (line 4), and `src/app/api/cron/poll-youtube/route.ts` (line 7)
- `YT_TIMEOUT_MS = 8_000` — in `admin.ts` (line 28) and `video-stats/route.ts` (line 5)

A new YouTube URL format (e.g., `youtube.com/live/`) added to one file silently misses the others. A YouTube API version bump requires finding and updating 3 independent constant definitions.

`src/lib/constants.ts` already exists and houses YouTube regex patterns (`YOUTUBE_THUMBNAIL_RE`, `YOUTUBE_CHANNEL_ID_RE`) — these belong there too.

## Proposed Solution

**Option A (Recommended):** Move to `src/lib/constants.ts`:
```typescript
export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YT_TIMEOUT_MS = 8_000;
```

Move `extractVideoId` to `src/lib/youtube.ts` (the file already exists):
```typescript
// src/lib/youtube.ts
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}
```

**Option B:** Only consolidate the constants (simpler); keep `extractVideoId` local if the service extraction (todo #070) will do the consolidation anyway.

- **Effort**: Small
- **Risk**: Low — import changes only, no logic change

## Acceptance Criteria

- [ ] `extractVideoId` defined once and imported in `admin.ts` and `video-stats/route.ts`
- [ ] `YOUTUBE_API_BASE` defined once and imported in all 3 files
- [ ] `YT_TIMEOUT_MS` defined once and imported in all 2 files that use it
- [ ] TypeScript compiles clean; all existing tests pass

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist (P2-A, P2-B), agent-native-reviewer (P3-10)
