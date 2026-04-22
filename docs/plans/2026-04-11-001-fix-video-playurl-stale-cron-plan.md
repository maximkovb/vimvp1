---
title: "fix: Refresh playUrl in poll-tiktok cron to prevent blank video on restart"
type: fix
status: completed
date: 2026-04-11
origin: docs/brainstorms/2026-04-11-video-playurl-stale-requirements.md
---

# fix: Refresh playUrl in poll-tiktok cron to prevent blank video on restart

TikWM CDN-signed `playUrl` values expire ~24h after fetch. They are stored once at market creation time in `videoMetadata.playUrl` and never refreshed. After a server restart (or 24h+ uptime), clients receive the stale URL and the video area is blank. The `onError` client-side recovery is unreliable — some CDN failure modes do not fire the video element's `error` event — leaving some markets permanently blank.

The `poll-tiktok` cron already fetches fresh `TikTokStats` (including `playUrl`) every 10 minutes for all active/halted markets. It currently updates `videoMetadata.thumbnail` but silently discards the fresh `playUrl`. The fix is to also persist `playUrl` in that same update.

## Acceptance Criteria

- [ ] After a server restart, all market videos load on first render without requiring the `onError` fallback.
- [ ] `videoMetadata.playUrl` in the DB is never more than ~10 minutes stale for active/halted markets.
- [ ] An empty `playUrl` returned by TikWM (`""`) never overwrites a previously valid non-empty URL.
- [ ] The thumbnail refresh behaviour is unchanged — still gated by `TIKTOK_THUMBNAIL_RE`.
- [ ] Only one `db.update()` call is made per market per cron cycle (no extra round-trip).

## Implementation

**Single file: `src/app/api/cron/poll-tiktok/route.ts`**

Replace the existing thumbnail-only update block (lines 104–116):

```ts
// BEFORE — only thumbnail, skipped entirely when thumbnail URL fails regex
if (stats?.thumbnailUrl && TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl)) {
  await db
    .update(markets)
    .set({
      videoMetadata: {
        ...(market.videoMetadata ?? { title: "", channelTitle: "" }),
        thumbnail: stats.thumbnailUrl,
      },
    })
    .where(eq(markets.id, market.id));
}
```

With a merged update that handles both fields:

```ts
// AFTER — updates thumbnail (when CDN URL is valid) and playUrl (when non-empty),
// in a single UPDATE so both fields are always kept fresh alongside each other.
if (stats !== null) {
  const newThumbnail =
    stats.thumbnailUrl && TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl)
      ? stats.thumbnailUrl
      : undefined;
  const newPlayUrl = stats.playUrl || undefined; // guard: don't overwrite with ""

  if (newThumbnail !== undefined || newPlayUrl !== undefined) {
    await db
      .update(markets)
      .set({
        videoMetadata: {
          ...(market.videoMetadata ?? { title: "", channelTitle: "" }),
          ...(newThumbnail !== undefined ? { thumbnail: newThumbnail } : {}),
          ...(newPlayUrl !== undefined ? { playUrl: newPlayUrl } : {}),
        },
      })
      .where(eq(markets.id, market.id));
  }
}
```

**Why this shape:**
- Moves inside `if (stats !== null)` — consistent with the poll insert and auto-resolve blocks above it.
- Single `db.update()` — avoids a non-transactional two-update pattern where a crash could leave thumbnail updated but `playUrl` stale.
- `stats.playUrl || undefined` — TikWM returns `""` when the play URL is unavailable; the guard ensures we never overwrite a previously valid URL with an empty string.
- `thumbnail` guard is unchanged — still requires a valid TikTok CDN domain.
- Conditional outer guard (`newThumbnail !== undefined || newPlayUrl !== undefined`) — skips the UPDATE entirely if TikWM returned neither a valid thumbnail nor a non-empty playUrl (avoids a no-op write).

## Context

**No DB migration needed.** `playUrl` is already declared optional in the `videoMetadata` JSONB type at `src/db/schema.ts:112`:
```ts
playUrl?: string | null;
```

**Markets created via the agent route (`POST /api/markets`) have no initial `playUrl`** — `CreateMarketSchema` in `src/app/api/markets/route.ts` does not accept it. The first cron cycle after creation will correctly populate it.

**Startup gap (accepted, out of scope):** For up to 10 minutes after a server restart, newly-visited pages may still serve a stale URL. The existing `onError` client-side recovery handles this window as a secondary fallback. A future enhancement could have `GET /api/tiktok/[videoId]/play-url` write the fresh URL back to the DB on success — but that is out of scope for this fix.

**Pre-existing out-of-scope bug:** `FeedCard.tsx:251` passes `videoMetadata?.playUrl` (the original server-rendered prop) to `<TikTokEmbed>`, not the `currentPlayUrl` state that `handleVideoError` updates. This means desktop layout re-renders do not pick up client-side refreshed URLs. Once the cron fix lands, the DB value will be fresh, so this matters less — but it remains a latent inconsistency.

## Sources

- **Origin document:** [docs/brainstorms/2026-04-11-video-playurl-stale-requirements.md](../brainstorms/2026-04-11-video-playurl-stale-requirements.md)
  Key decisions carried forward: (1) cron as sole writer for freshness, (2) no page-render latency added, (3) client-side `onError` kept as secondary fallback.
- Thumbnail update to extend: `src/app/api/cron/poll-tiktok/route.ts:104–116`
- `playUrl` in schema: `src/db/schema.ts:112`
- `stats.playUrl` source: `src/lib/tiktok.ts:75`
- Client consumption (market page): `src/app/markets/[id]/page.tsx:109`
- Client consumption (feed): `src/components/FeedCard.tsx:143`
