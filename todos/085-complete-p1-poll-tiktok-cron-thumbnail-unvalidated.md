---
status: pending
priority: p1
issue_id: "085"
tags: [code-review, security, tiktok, cron, thumbnail]
dependencies: []
---

# poll-tiktok Cron: Thumbnail URL Not Validated Before Storage

## Problem Statement

The `poll-tiktok` cron route refreshes `videoMetadata.thumbnail` with the URL returned by TikAPI on every poll cycle, without validating that the URL matches the allowed TikTok CDN pattern (`TIKTOK_THUMBNAIL_RE`). This allows a malicious or compromised TikAPI response to store an arbitrary URL in the database, which is then rendered via `next/image` and served to all users.

This is the same class of vulnerability that was previously fixed for the admin path (todo #029), but the fix was not applied to the cron path.

## Findings

From `src/app/api/cron/poll-tiktok/route.ts` (approx lines 85–97):

```ts
if (stats.thumbnailUrl) {
  await db
    .update(markets)
    .set({
      videoMetadata: {
        ...market.videoMetadata,
        thumbnail: stats.thumbnailUrl,  // ← no validation
      },
    })
    .where(eq(markets.id, market.id));
}
```

`TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn\.com\//` is defined in `src/lib/constants.ts` but not imported or applied here.

The fix applied in the admin action (`src/lib/actions/admin.ts`) validates thumbnails before storage, but the cron refresh path bypasses this entirely.

## Proposed Solutions

### Option A: Add Validation Before Cron Update (Recommended)
```ts
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";

if (stats.thumbnailUrl && TIKTOK_THUMBNAIL_RE.test(stats.thumbnailUrl)) {
  await db.update(markets).set({ videoMetadata: { ...market.videoMetadata, thumbnail: stats.thumbnailUrl } }).where(eq(markets.id, market.id));
}
```

**Pros:** Consistent with admin path; one-line fix
**Effort:** Small
**Risk:** None — only adds a guard

### Option B: Skip Thumbnail Refresh in Cron
Remove the thumbnail update from the cron entirely — thumbnails are set at creation and don't need per-poll refreshes.

**Pros:** Simpler cron logic; eliminates the attack surface
**Cons:** Thumbnails can become stale if TikTok rotates CDN URLs
**Effort:** Small

## Recommended Action

Option A — add the `TIKTOK_THUMBNAIL_RE.test()` guard. Single line change, matches the existing admin path pattern.

## Technical Details

- **Affected file:** `src/app/api/cron/poll-tiktok/route.ts`
- **Fix:** Import `TIKTOK_THUMBNAIL_RE` and add `.test(stats.thumbnailUrl)` guard before the `db.update`
- **Related:** todo #029 (completed) — same fix applied to admin action path

## Acceptance Criteria

- [ ] Cron thumbnail update path validates URL against `TIKTOK_THUMBNAIL_RE` before storing
- [ ] Invalid/unexpected thumbnail URLs from TikAPI are silently ignored (not stored)
- [ ] Existing tests cover the validation path

## Work Log

- 2026-03-29: Identified by security-sentinel agent during TikTok integration code review
