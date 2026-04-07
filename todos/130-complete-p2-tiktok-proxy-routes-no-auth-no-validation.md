---
name: TikTok proxy routes have no auth and no videoId format validation
description: /api/tiktok/[videoId]/play-url and /stream accept any string as videoId with no auth, enabling open proxy abuse
type: bug
status: pending
priority: p2
issue_id: "130"
tags: [code-review, security, api, tiktok]
dependencies: []
---

## Problem Statement

Both `/api/tiktok/[videoId]/play-url` and `/api/tiktok/[videoId]/stream` are publicly accessible with no authentication and no `videoId` format validation. The `videoId` is embedded directly into TikWM URL strings. The `/stream` route is an open video proxy — for any valid TikTok video ID (not just ones with markets), the server fetches a CDN URL from TikWM and proxies the video, consuming your TikWM quota and bandwidth with no metering.

## Findings

- **`src/app/api/tiktok/[videoId]/play-url/route.ts`**: no auth, no `TIKTOK_VIDEO_ID_RE` validation
- **`src/app/api/tiktok/[videoId]/stream/route.ts`**: no auth, fetches from TikWM even when no market exists for the `videoId`
- `fetchTikTokStatsById` constructs `url = https://www.tikwm.com/api/?url=.../video/${videoId}` with unsanitized input

## Proposed Solutions

### Option A: Add videoId format validation + market existence check to /stream
1. Add `TIKTOK_VIDEO_ID_RE.test(videoId)` guard in both routes, return 400 if invalid
2. In `/stream`, return 404 immediately if no market exists for the `videoId` — don't fall through to live TikWM fetch
3. Optionally add auth to `/play-url` as well to prevent unmetered relay

- **Effort:** Small
- **Risk:** None

## Acceptance Criteria
- [ ] Both routes return 400 for invalid `videoId` format
- [ ] `/stream` returns 404 when no market record exists for `videoId`
- [ ] No unauthenticated open proxy for arbitrary TikTok videos

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
