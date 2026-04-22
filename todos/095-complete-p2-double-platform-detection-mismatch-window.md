---
status: pending
priority: p2
issue_id: "095"
tags: [code-review, architecture, tiktok, admin]
dependencies: []
---

# Admin Form: URL Edit Between Fetch and Submit Produces Mismatched Market Metadata

## Problem Statement

Platform and video ID are detected twice, independently:
1. When the admin clicks "Fetch" — `fetchVideoStats` detects `platform` from the URL and returns it along with metadata (thumbnail, tikapiPostId, channelTitle, etc.)
2. When the admin clicks "Publish" — `createMarket` calls `isTikTokUrl(videoUrl)` again on the URL currently in the input field

If the admin edits the URL between these two actions, `createMarket` detects the platform from video B but writes the metadata (thumbnail, tikapiPostId) that was fetched for video A. The resulting market has a split identity — platform/videoId from one video, display metadata from another.

There is no server-side consistency check between the fetched metadata and the submitted URL.

## Findings

From `src/lib/actions/admin.ts`:
- Line 193: `const detectedPlatform = isTikTokUrl(videoUrl) ? "tiktok" : "youtube"` — re-derives from submitted form URL
- Line 196: `const videoId = detectedPlatform === "tiktok" ? extractTikTokVideoId(videoUrl) ?? "" : ...` — re-extracts from submitted form URL

From `src/app/admin/markets/new/page.tsx`:
- The `videoUrl` state used for "Fetch" and the `videoUrl` sent in `formData` are the same React state variable — but there is nothing preventing the user from changing the input between the two events
- `publishDisabled` (line 264) does not validate that `videoUrl` matches the URL used during the original fetch

## Proposed Solutions

### Option A: Store Fetched Platform as Hidden Field + Server Cross-Check (Recommended)
After `fetchVideoStats` returns, store `platform` as a hidden form field alongside the other fetched metadata. In `createMarket`, read the stored `platform` value and cross-check it against the URL-derived platform:

```tsx
// In page.tsx, after fetch:
<input type="hidden" name="fetchedPlatform" value={videoStats?.platform ?? ""} />
```

```ts
// In createMarket:
const submittedPlatform = formData.get("fetchedPlatform") as string;
const detectedPlatform = isTikTokUrl(videoUrl) ? "tiktok" : "youtube";
if (submittedPlatform && submittedPlatform !== detectedPlatform) {
  return { error: "Video URL was changed after fetching stats. Please re-fetch." };
}
```

**Pros:** Catches the mismatch before DB insert; user gets a clear error
**Effort:** Small
**Risk:** None

### Option B: Disable the URL Input After Fetch
After `fetchVideoStats` succeeds, set the URL input to `readOnly` until the user explicitly clicks "Reset". Prevents the mismatch window entirely at the UX level.

**Pros:** Prevents the problem rather than detecting it
**Cons:** UX change; user can't easily fix a typo without resetting
**Effort:** Small

## Recommended Action

Option A — lightweight server-side cross-check with a clear user-facing error message. Takes 3-4 lines.

## Technical Details

- **Affected files:** `src/app/admin/markets/new/page.tsx`, `src/lib/actions/admin.ts`
- **New hidden field:** `fetchedPlatform` populated from `videoStats.platform`
- **Cross-check location:** `createMarket` around line 193

## Acceptance Criteria

- [ ] Editing the URL after fetch triggers a validation error on submit
- [ ] Error message instructs user to re-fetch before publishing
- [ ] Normal flow (no URL edit) unchanged

## Work Log

- 2026-03-29: Identified by architecture-strategist during TikTok integration code review
