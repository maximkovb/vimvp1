---
status: pending
priority: p2
issue_id: "130"
tags: [code-review, security, architecture]
dependencies: []
---

# playUrl persisted without domain validation (unlike thumbnail)

## Problem Statement

`videoMetadata.playUrl` is written to the DB without any domain allowlist check, while `videoMetadata.thumbnail` is validated against `TIKTOK_THUMBNAIL_RE` before every write. This asymmetry violates the project's own documented convention ("only persist URLs from the known TikTok CDN domain") and creates a supply-chain injection path if the TikWM public API ever returns a manipulated `d.play` value.

The field is used directly as `<video src>` in both `TikTokEmbed.tsx` and `FeedCard.tsx`, then served to every user who views a market.

## Findings

**Security agent:** The `<video src>` surface doesn't execute JavaScript, so direct XSS is not possible, but an arbitrary URL enables: outbound requests to attacker-controlled hosts (info leak), mixed-content failures (non-HTTPS), and silent video fallback if TikWM is compromised. Severity: Low today / Medium if TikWM is ever spoofed.

**Architecture agent:** This is the most significant architectural finding. Three separate write paths all persist `playUrl` without validation:
1. `src/app/api/cron/poll-tiktok/route.ts:113` — the new cron refresh path (this diff)
2. `src/lib/actions/admin.ts:209` — market creation via admin UI form action
3. `src/lib/actions/admin.ts:402` — `createTestMarket()`

The thumbnail path validates at every write site. `playUrl` validates at none.

**Relevant existing todo:** `029-complete-p2-thumbnail-url-stored-unvalidated.md` — fixed thumbnail validation. `playUrl` was not in scope at that time.

## Proposed Solutions

### Option A — Add `TIKTOK_PLAY_URL_RE` constant + apply at all write sites (Recommended)
Add a regex to `src/lib/constants.ts` matching TikWM's actual play URL domains (`tikwm.com`, `tiktokv.com`, `tiktokcdn.com`, `tiktokcdn-us.com`), then apply it as a pre-condition in all three write paths.

```ts
// src/lib/constants.ts
export const TIKTOK_PLAY_URL_RE =
  /^https:\/\/[a-z0-9.-]+\.(tikwm\.com|tiktokv\.com|tiktokcdn\.com|tiktokcdn-us\.com)\//;
```

In `poll-tiktok/route.ts`:
```ts
const newPlayUrl =
  stats.playUrl && TIKTOK_PLAY_URL_RE.test(stats.playUrl)
    ? stats.playUrl
    : undefined;
```

Same pattern in `admin.ts` at lines 209 and 402.

**Pros:** Mirrors thumbnail pattern exactly, closes supply-chain path, makes DB invariant enforceable.
**Cons:** Need to verify actual TikWM domain(s) in production before deploying regex — wrong pattern silently drops all play URLs.
**Effort:** Small. **Risk:** Low if domains are confirmed first.

### Option B — Log + allow for now, add validation later
Accept the current behavior and add a `console.warn` when a `playUrl` fails a basic HTTPS check, without blocking the write.

**Pros:** Zero risk of breaking existing markets.
**Cons:** Doesn't close the injection path. Only a monitoring improvement.
**Effort:** Trivial. **Risk:** Very low.

## Recommended Action
Option A — but **confirm the actual TikWM play URL domain** by inspecting a real `stats.playUrl` value from a live market before finalizing the regex. Run `console.log(stats.playUrl)` in a local dev poll or check existing DB rows.

## Technical Details
- **Affected files:**
  - `src/lib/constants.ts` — add `TIKTOK_PLAY_URL_RE`
  - `src/app/api/cron/poll-tiktok/route.ts:113` — apply regex guard on `newPlayUrl`
  - `src/lib/actions/admin.ts:209` — apply guard on `playUrlRaw` before market creation write
  - `src/lib/actions/admin.ts:402` — apply guard on `playUrl` in `createTestMarket`

## Acceptance Criteria
- [ ] `TIKTOK_PLAY_URL_RE` constant exists in `src/lib/constants.ts` and matches observed TikWM play URL domains
- [ ] `stats.playUrl` fails regex → `newPlayUrl` is `undefined`, DB value unchanged
- [ ] `stats.playUrl` is a valid TikWM CDN URL → written correctly to DB
- [ ] Same guard applied in both admin.ts creation paths
- [ ] Existing DB rows with valid `playUrl` are unaffected by the regex (verified by spot-check)

## Work Log
- 2026-04-11 — Created from ce:review of `fix(cron): refresh playUrl in poll-tiktok alongside thumbnail`
