---
status: complete
priority: p3
issue_id: "047"
tags: [code-review, performance, api]
dependencies: []
---

# YouTube API Calls Use Same `revalidate: 3600` — Channel ID Is Permanent

## Problem Statement

`fetchChannelRecentVideos` makes three sequential API calls, all with `{ next: { revalidate: 3600 } }` (1 hour). The first call (channels API → uploads playlist ID) retrieves data that is **permanent** — a YouTube channel's upload playlist ID never changes. Revalidating it every hour wastes one quota unit per unique channel per hour and adds unnecessary cache churn.

## Findings

- `src/lib/youtube.ts`: all three `fetch` calls use `{ next: { revalidate: 3600 } }`
- Step 1 (channels): uploads playlist ID is immutable per channel → should revalidate ~24 hours or longer
- Step 2 (playlistItems): video list changes only on new uploads → 15 minutes is reasonable
- Step 3 (videos stats): view/like counts change frequently → 1 hour is appropriate
- With the current uniform TTL, deploying to production invalidates all cached channel responses simultaneously, potentially triggering N quota units in a burst
- Performance oracle identified this; quota is 10,000 units/day

## Proposed Solutions

### Solution A: Differentiate `revalidate` TTLs per call type (Recommended)
```ts
// Step 1: uploads playlist ID is permanent
const channelRes = await fetch(url, { next: { revalidate: 86400 } }); // 24 hours

// Step 2: playlist items change only on new uploads
const playlistRes = await fetch(url, { next: { revalidate: 900 } }); // 15 minutes

// Step 3: video stats change frequently
const videosRes = await fetch(url, { next: { revalidate: 3600 } }); // 1 hour (unchanged)
```
- **Pros**: Reduces quota burn ~33% for step 1; deploy cache invalidation is staged
- **Cons**: Slightly more complex
- **Effort**: Trivial (3 number changes)
- **Risk**: Very low — only affects cache TTL, not data correctness

### Solution B: Keep uniform 1-hour TTL
- **Pros**: No change
- **Cons**: Wastes quota on immutable data
- **Effort**: None
- **Risk**: None (current behavior)

## Recommended Action

Solution A at a convenient time. Not urgent, but a trivial improvement.

## Technical Details

- **Affected files**: `src/lib/youtube.ts`

## Acceptance Criteria

- [ ] Channels API call uses `revalidate: 86400` (or longer)
- [ ] PlaylistItems API call uses `revalidate: 900`
- [ ] Videos stats API call uses `revalidate: 3600`
- [ ] Channel history on market pages correctly reflects video list changes within 15 minutes of a new upload

## Work Log

- 2026-03-23: Identified by performance-oracle during code review of feat/video-intelligence-panel
