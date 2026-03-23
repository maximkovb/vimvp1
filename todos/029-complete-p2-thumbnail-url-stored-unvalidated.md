---
status: pending
priority: p2
issue_id: "029"
tags: [code-review, security, validation, xss]
dependencies: []
---

# Thumbnail URL from Hidden Form Input Stored Unvalidated in Database

## Problem Statement

`createMarket()` reads `thumbnail` from a hidden form field (`formData.get("thumbnail")`) and stores it directly in `videoMetadata.thumbnail` (a JSONB column) without validating that it is a YouTube CDN URL. While the page is admin-only (reducing the threat surface), a tampered FormData POST from a compromised admin session could inject an arbitrary URL. This value is rendered in market listing components — if rendered via a plain `<img>` tag (currently the case in `page.tsx:167`), it creates a tracking pixel vector. The `next/image` component in `MarketCard` does enforce CDN whitelisting, but the admin preview uses a plain `<img>`.

## Findings

- `admin.ts:196` — `const thumbnail = (formData.get("thumbnail") as string) || ""`
- `admin.ts:218` — stored directly: `videoMetadata: { thumbnail }` — no validation
- `page.tsx:167` — `<img src={videoPreview.thumbnail}>` — plain img, no CDN check
- `next.config.ts:6-9` — `remotePatterns` whitelist applies only to Next.js `<Image>`, not `<img>`

## Proposed Solutions

### Option 1: Validate thumbnail URL pattern in `createMarket` (Recommended)

```typescript
const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//;
if (thumbnail && !YOUTUBE_THUMBNAIL_RE.test(thumbnail)) {
  return { error: "Invalid thumbnail URL" };
}
```

**Pros:** Prevents arbitrary URLs from being stored; minimal change
**Cons:** Rejects valid YouTube thumbnails from `img.youtube.com` — add that domain too if needed
**Effort:** Small
**Risk:** Low

---

### Option 2: Replace plain `<img>` with Next.js `<Image>` in admin preview

Ensures the CDN whitelist in `next.config.ts` applies as a second defense layer.

**Pros:** Defense in depth
**Cons:** Requires `width`/`height` props; slightly more change
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1 immediately. Option 2 as a follow-up defense-in-depth improvement.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:196-219`
- `src/app/admin/markets/new/page.tsx:167` (optional improvement)

## Acceptance Criteria

- [ ] `createMarket` with a non-YouTube `thumbnail` value returns a validation error
- [ ] `createMarket` with a `javascript:` URI thumbnail returns a validation error
- [ ] Valid `https://i.ytimg.com/...` thumbnails continue to work
- [ ] No arbitrary URLs are stored in the `videoMetadata.thumbnail` column

## Work Log

### 2026-03-23 - Discovery

**By:** Security Sentinel + Architecture Strategist (code review agents)
