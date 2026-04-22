---
status: pending
priority: p2
issue_id: "091"
tags: [code-review, security, tiktok, validation]
dependencies: []
---

# isTikTokUrl Uses Substring Match That Can Be Bypassed

## Problem Statement

`isTikTokUrl` in `src/lib/tiktok.ts` uses a simple regex substring match: `/tiktok\.com/i.test(url)`. This means a URL like `https://evil.com/redirect?ref=tiktok.com` or `https://malicious.site/tiktok.com/video/123` would be classified as a TikTok URL, triggering the TikTok code path (calling TikAPI with attacker-controlled content, setting platform to "tiktok").

While the downstream extraction (`extractTikTokVideoId`) validates the video ID format, the platform misclassification itself could lead to unexpected behavior.

## Findings

From `src/lib/tiktok.ts`:
```ts
export function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url);
}
```

A proper hostname check would be:
```ts
try {
  const { hostname } = new URL(url);
  return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
} catch {
  return false;
}
```

This also handles the case where `url` is not a valid URL (currently would silently match if "tiktok.com" appears anywhere in the string).

## Proposed Solutions

### Option A: Use URL Hostname Check (Recommended)
```ts
export function isTikTokUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}
```

**Pros:** Correct; handles malformed URLs gracefully
**Effort:** Trivial
**Risk:** None — more restrictive, only rejects invalid inputs

### Option B: Allowlist Specific Hostnames
Check against `["tiktok.com", "vm.tiktok.com", "www.tiktok.com", "m.tiktok.com"]`.

**Pros:** Even more restrictive
**Cons:** May need updates as TikTok adds subdomains
**Effort:** Trivial

## Recommended Action

Option A — use `URL` constructor for proper hostname parsing. One function, no behavior change for valid inputs.

## Technical Details

- **Affected file:** `src/lib/tiktok.ts`
- **Function:** `isTikTokUrl`

## Acceptance Criteria

- [ ] `isTikTokUrl("https://evil.com?ref=tiktok.com")` returns `false`
- [ ] `isTikTokUrl("https://www.tiktok.com/@user/video/123")` returns `true`
- [ ] `isTikTokUrl("not-a-url")` returns `false` (no throw)
- [ ] Existing platform detection behavior unchanged for valid TikTok URLs

## Work Log

- 2026-03-29: Identified by security-sentinel agent during TikTok integration code review
