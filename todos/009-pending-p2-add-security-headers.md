---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, security]
dependencies: []
---

# Add HTTP Security Headers to next.config.ts

## Problem Statement

The application has no HTTP security headers configured. There is no Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, or Referrer-Policy. This leaves the app vulnerable to clickjacking (trading UI can be embedded in a malicious frame), MIME-sniffing, and provides no restriction on script sources in case of a stored XSS.

## Findings

- `src/next.config.ts`: only contains image remotePatterns; no `headers()` export
- No CSP means any injected script would execute without browser restriction
- No X-Frame-Options means the entire app (including trade buttons) can be framed for clickjacking
- No HSTS means first-visit HTTP connections are unprotected
- YouTube embeds on market detail pages require `frame-src https://www.youtube.com` in CSP
- `allowFullScreen` on YouTube iframes (markets/[id]/page.tsx:82) in combination with no framing policy creates clickjacking surface

## Proposed Solutions

### Option 1: Add headers() to next.config.ts

```typescript
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",  // Next.js requires unsafe-inline for hydration
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https://i.ytimg.com https://img.youtube.com data: blob:",
            "frame-src https://www.youtube.com",
            "connect-src 'self'",
            "font-src 'self'",
          ].join("; "),
        },
      ],
    },
  ];
},
```

**Pros:** Standard Next.js approach; immediate protection
**Cons:** `unsafe-inline` weakens script-src; Next.js requires nonce-based CSP for strict mode (more complex)

**Effort:** 1 hour
**Risk:** Low (but test that YouTube embeds and OAuth redirects still work)

## Recommended Action

Option 1. Start with the basic headers; upgrade CSP to nonce-based in a follow-up.

## Technical Details

**Affected files:**
- `next.config.ts` — add `headers()` export

## Acceptance Criteria

- [ ] `X-Frame-Options: SAMEORIGIN` header present on all pages
- [ ] `X-Content-Type-Options: nosniff` header present
- [ ] `Strict-Transport-Security` header present with long max-age
- [ ] `Content-Security-Policy` header present and allows YouTube iframes
- [ ] Google OAuth redirect flow still works after CSP is applied
- [ ] YouTube video embeds on market pages still load

## Work Log

### 2026-03-22 - Discovery

**By:** Security sentinel (code review)
