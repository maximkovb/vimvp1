---
status: pending
priority: p1
issue_id: "024"
tags: [code-review, performance, youtube-api, quota]
dependencies: []
---

# `search.list` Costs 100 Quota Units — Replace with `playlistItems.list` (1 Unit)

## Problem Statement

`fetchVideoMetadata()` uses the YouTube `search.list` endpoint to retrieve the channel's 10 most-recent video IDs (line 84 of `admin.ts`). The search endpoint costs 100 quota units per call. The daily YouTube Data API quota is 10,000 units. Combined with the other calls per fetch (3+3+30 = 36 units), each admin "Fetch" click costs ~136 units, exhausting the daily quota after only 73 clicks. The search call is not needed here — `playlistItems.list` retrieves the same data (recent video IDs ordered by date) for 1 quota unit using the channel's uploads playlist ID, which is already available from the channel stats call.

## Findings

- `src/lib/actions/admin.ts:84–88` — `search?part=snippet&channelId=...&order=date&maxResults=10` — 100 units/call
- YouTube Data API quota: `search.list` = 100 units, `playlistItems.list` = 1 unit
- Current cost per click: ~136 quota units → 73 admin fetches before daily exhaustion
- Post-fix cost: ~37 units → 270 admin fetches per day

## Proposed Solutions

### Option 1: Replace `search.list` with `playlistItems.list` (Recommended)

**Step 1:** Add `contentDetails` to the channels fetch to get the uploads playlist ID:
```typescript
`${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&id=${channelId}&key=${apiKey}&fields=items(statistics/subscriberCount,contentDetails/relatedPlaylists/uploads)`
```

**Step 2:** Replace `searchRes` with `playlistItemsRes`:
```typescript
const uploadsPlaylistId = channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

let recentVideoIds: string[] = [];
if (uploadsPlaylistId) {
  const playlistRes = await fetch(
    `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}&fields=items(snippet/resourceId/videoId)`,
    { cache: "no-store" }
  );
  if (playlistRes.ok) {
    const playlistData = await playlistRes.json();
    recentVideoIds = (playlistData.items ?? [])
      .map((v: { snippet?: { resourceId?: { videoId?: string } } }) => v.snippet?.resourceId?.videoId)
      .filter((id): id is string => Boolean(id));
  }
}
```

**Note:** `playlistItems.list` includes private/deleted videos that `search.list` silently excludes. These will silently produce no statistics in the batch stats call, which already handles missing items gracefully.

**Pros:** 99-unit savings per click; 3.7× more daily capacity; same functional result
**Cons:** Includes private/deleted video stubs (harmless — they produce no stats entry); requires adding `contentDetails` to the channels request
**Effort:** Small
**Risk:** Low

---

### Option 2: Cache the uploads playlist ID

Cache the `uploadsPlaylistId` per `channelId` in a server-side KV store (Vercel KV or similar) with a 24h TTL, so repeat fetches of videos from the same channel skip the channels call entirely.

**Pros:** Additional quota savings for repeat creators
**Cons:** Adds infrastructure dependency
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option 1 immediately. Option 2 can follow if the same channel is fetched frequently.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:79–115` — replace search call in the `Promise.all`

**API reference:**
- `playlistItems.list`: 1 quota unit, returns `snippet.resourceId.videoId` for each item
- `channels?part=contentDetails`: adds `contentDetails.relatedPlaylists.uploads` playlist ID

## Acceptance Criteria

- [ ] `search.list` endpoint is no longer called in `fetchVideoMetadata()`
- [ ] `playlistItems.list` is called instead using the uploads playlist ID from the channel stats response
- [ ] The same 10 recent video IDs are returned for a known channel (verify against previous behavior)
- [ ] Google Cloud Console shows ~37 quota units consumed per test fetch (not ~136)
- [ ] Channel with no uploads playlist (brand-new channel) falls back gracefully with `recentViewCounts = []`

## Work Log

### 2026-03-23 - Discovery

**By:** Performance Oracle (code review agent)
