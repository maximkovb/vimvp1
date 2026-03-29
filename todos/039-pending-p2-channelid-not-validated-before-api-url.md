---
status: complete
priority: p2
issue_id: "039"
tags: [code-review, security]
dependencies: []
---

# `channelId` Not Validated Before YouTube API URL Interpolation

## Problem Statement

`fetchChannelRecentVideos` in `src/lib/youtube.ts` interpolates `channelId` directly into a YouTube API URL without validating or encoding it. While channel IDs are stored from `fetchVideoMetadata` in `admin.ts` (which does validate YouTube thumbnails), a malformed or crafted `channelId` in `videoMetadata` JSONB could manipulate the constructed URL via path traversal or parameter injection.

## Findings

- `src/lib/youtube.ts`: `` `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}` `` — raw interpolation, no validation or encoding
- YouTube channel IDs follow a strict pattern: `/^UC[a-zA-Z0-9_-]{22}$/` (24 chars total)
- A value like `UCfoo&part=id&id=UCbar` would inject additional query parameters
- `channelId` originates from JSONB which is written by the admin form — admin-only access mitigates risk, but defense-in-depth requires validation at the consumption point
- Security sentinel rated this medium severity

## Proposed Solutions

### Solution A: Validate against YouTube channel ID regex + use encodeURIComponent (Recommended)
```ts
const CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/;

export async function fetchChannelRecentVideos(channelId: string): Promise<ChannelVideo[]> {
  if (!CHANNEL_ID_RE.test(channelId)) return [];
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  // Use encodeURIComponent for belt-and-suspenders
  const encodedChannelId = encodeURIComponent(channelId);
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodedChannelId}&key=${apiKey}`,
    { next: { revalidate: 3600 } }
  );
```
- **Pros**: Stops invalid IDs before any API call; encodes any unexpected characters
- **Cons**: None
- **Effort**: Small
- **Risk**: Low — valid channel IDs pass the regex; invalid ones return [] gracefully

### Solution B: encodeURIComponent only (no regex)
Wrap `channelId` in `encodeURIComponent` without the format check.
- **Pros**: Handles injection
- **Cons**: Doesn't catch malformed IDs early; still makes an API call for garbage input
- **Effort**: Trivial
- **Risk**: Medium — quota units wasted on invalid IDs

## Recommended Action

Solution A. Add `CHANNEL_ID_RE` to `src/lib/constants.ts` alongside `YOUTUBE_THUMBNAIL_RE` (see todo 041).

## Technical Details

- **Affected files**: `src/lib/youtube.ts`
- **Constants**: Add `CHANNEL_ID_RE` to `src/lib/constants.ts`

## Acceptance Criteria

- [ ] `fetchChannelRecentVideos` validates `channelId` against `/^UC[a-zA-Z0-9_-]{22}$/` and returns `[]` for non-matching values
- [ ] `channelId` is passed through `encodeURIComponent` in the URL construction
- [ ] Valid channel IDs (e.g. `UCVHFbw7woebKtFFixAjQR6Q`) still return results correctly
- [ ] A crafted ID like `UCfoo&part=id` returns `[]` without making an API call

## Work Log

- 2026-03-23: Identified by security-sentinel during code review of feat/video-intelligence-panel
