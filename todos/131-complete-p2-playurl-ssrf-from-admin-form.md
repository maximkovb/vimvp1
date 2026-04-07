---
name: playUrl stored from admin form field without domain validation — SSRF risk
description: createMarket server action stores playUrl from browser form input; used as fetch() target in /stream route without URL allowlist
type: bug
status: pending
priority: p2
issue_id: "131"
tags: [code-review, security, ssrf, admin]
dependencies: []
---

## Problem Statement

`createMarket` in `src/lib/actions/admin.ts:173-214` stores `playUrl` from a hidden form field without domain validation. This URL is later used as the `fetch()` target in `/api/tiktok/[videoId]/stream/route.ts`. An admin (or someone who manipulates hidden form fields via DevTools) could set `playUrl` to an internal network address (e.g., `http://169.254.169.254/latest/meta-data/` — AWS IMDS), causing your server to proxy a request to that address.

**Why:** `thumbnail` is validated against `TIKTOK_THUMBNAIL_RE`, but `playUrl` has no equivalent validation.

## Findings

- **`src/lib/actions/admin.ts:181-197`**: `playUrlRaw` stored as-is in `videoMetadata`
- **`src/app/api/tiktok/[videoId]/stream/route.ts:81`**: `cachedUrl` used as `fetch()` target without re-validation

## Proposed Solutions

### Option A: Add SSRF allowlist regex for playUrl (Recommended)
```ts
const TIKTOK_PLAY_URL_RE = /^https:\/\/[a-z0-9-]+\.(tiktokcdn(?:-us)?|tiktokv)\.com\//;
const playUrl = playUrlRaw && TIKTOK_PLAY_URL_RE.test(playUrlRaw) ? playUrlRaw : undefined;
```
- **Effort:** Tiny (same pattern as thumbnail validation)
- **Risk:** None

### Option B: Re-fetch playUrl server-side from TikWM instead of trusting the form
Eliminates the SSRF surface entirely — never trust a browser-supplied URL as a fetch target.
- **Effort:** Small

## Acceptance Criteria
- [ ] `playUrl` values that don't match TikTok CDN domains are rejected at the server action level
- [ ] The stream route only fetches from validated CDN domains

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
