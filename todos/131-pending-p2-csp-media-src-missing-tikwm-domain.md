---
status: pending
priority: p2
issue_id: "131"
tags: [code-review, security, performance]
dependencies: ["130"]
---

# CSP `media-src` may not include TikWM play URL domain

## Problem Statement

If TikWM serves `playUrl` values from `tikwm.com` (rather than from `tiktokcdn.com` / `tiktokv.com`), the browser's Content Security Policy will block the `<video src>` load — because `tikwm.com` is not in the `media-src` directive. The cron refresh fix correctly populates the DB with fresh URLs, but if those URLs are blocked by CSP at the browser level the video area will still be blank. The `onError` fallback then fires, calls the same TikWM API, gets the same domain URL, and the cycle repeats — permanent blank.

## Findings

**Security agent (Finding 2):** Current `media-src` in `next.config.ts` headers:
```
media-src 'self' https://*.tiktok.com https://*.tiktokv.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com
```
`tikwm.com` is absent. If `stats.playUrl` returns `https://api.tikwm.com/...` the browser will block it and the cron fix will appear to have no effect.

**Note:** Whether this is actually a problem depends entirely on the domain TikWM uses for `d.play` in practice. This needs to be confirmed empirically before acting.

## Proposed Solutions

### Option A — Verify domain empirically first (Recommended)
Check `stats.playUrl` from a live poll response or existing DB row.

```sql
SELECT video_metadata->>'playUrl' FROM markets WHERE video_metadata->>'playUrl' IS NOT NULL LIMIT 5;
```

If the domain is already in `media-src` → no change needed.
If `tikwm.com` → add `https://*.tikwm.com` to `media-src` in `next.config.ts`.

**Pros:** Data-driven, no unnecessary changes.
**Cons:** Requires access to staging/prod DB or a live poll run.
**Effort:** Small. **Risk:** Low.

### Option B — Add `tikwm.com` preemptively to `media-src`
Add `https://*.tikwm.com` to the CSP `media-src` directive.

**Pros:** Ensures no domain mismatch.
**Cons:** Widens CSP for a domain we may not actually need; violates CSP least-privilege principle.
**Effort:** Trivial. **Risk:** Low (widening, not restricting).

## Recommended Action
Option A — confirm the actual domain first. This can be done alongside todo #130 (adding `TIKTOK_PLAY_URL_RE` requires knowing the real domain anyway).

## Technical Details
- **Affected file:** `next.config.ts` — the `Content-Security-Policy` header string
- **Related:** `docs/solutions/runtime-errors/nextjs-image-missing-tiktok-cdn-hostname.md` — prior art for adding CDN domains to CSP + remotePatterns together

## Acceptance Criteria
- [ ] Domain of real TikWM `playUrl` values confirmed (query DB or inspect a live poll response)
- [ ] If domain is NOT in `media-src`: add it to `next.config.ts` `Content-Security-Policy` `media-src`
- [ ] If domain IS in `media-src`: close this todo as no-op
- [ ] Browser DevTools confirms `<video>` loads without CSP violation after update

## Work Log
- 2026-04-11 — Created from ce:review of `fix(cron): refresh playUrl in poll-tiktok alongside thumbnail`
