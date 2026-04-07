---
status: complete
priority: p2
issue_id: "040"
tags: [code-review, security, performance]
dependencies: []
---

# `<img>` in ChannelHistoryCards Bypasses Next.js Image Optimization

## Problem Statement

`ChannelHistoryCards` uses a plain HTML `<img>` tag for YouTube thumbnails. This bypasses Next.js's `<Image>` component, which enforces `remotePatterns` (allowlist of external image domains), provides automatic resizing/WebP conversion, and prevents CLS with explicit dimensions. Without it, any URL that passes `YOUTUBE_THUMBNAIL_RE` is fetched directly, and future CSP or image optimization benefits are lost.

## Findings

- `src/components/ChannelHistoryCards.tsx`: `<img src={video.thumbnail} alt={video.title} className="w-full aspect-video object-cover" />`
- No `width`, `height`, or `loading` attributes — browser cannot reserve layout space, causing CLS
- No `loading="lazy"` — all 10 thumbnails load eagerly when the Suspense boundary resolves
- YouTube medium thumbnails are 320×180px — known dimensions, no excuse for omitting them
- Security sentinel and performance oracle both flagged this

## Proposed Solutions

### Solution A: Replace with Next.js `<Image>` component (Recommended)
```tsx
import Image from "next/image";

<Image
  src={video.thumbnail}
  alt={video.title}
  width={320}
  height={180}
  className="w-full aspect-video object-cover"
/>
```
Add `{ hostname: "i.ytimg.com" }` to `next.config.ts` `images.remotePatterns` if not already present.
- **Pros**: Enforces allowlist, automatic WebP, lazy loading by default, prevents CLS
- **Cons**: Requires `remotePatterns` config entry (one line)
- **Effort**: Small
- **Risk**: Low — `YOUTUBE_THUMBNAIL_RE` already validates the hostname

### Solution B: Add `width`, `height`, `loading="lazy"` to plain `<img>`
```tsx
<img src={video.thumbnail} alt={video.title} width={320} height={180} loading="lazy" className="..." />
```
- **Pros**: Fixes CLS and lazy loading without config change
- **Cons**: No remotePatterns enforcement, no WebP conversion
- **Effort**: Trivial
- **Risk**: Low but incomplete

## Recommended Action

Solution A. Check `next.config.ts` for existing `remotePatterns` entries (likely already has `i.ytimg.com` given thumbnail validation elsewhere) and add the `<Image>` import.

## Technical Details

- **Affected files**: `src/components/ChannelHistoryCards.tsx`, potentially `next.config.ts`
- **Thumbnail dimensions**: YouTube medium thumbnails are always 320×180

## Acceptance Criteria

- [ ] `ChannelHistoryCards` uses `next/image` `<Image>` instead of `<img>`
- [ ] `next.config.ts` `images.remotePatterns` includes `hostname: "i.ytimg.com"`
- [ ] Thumbnails load lazily (not in the initial render waterfall)
- [ ] No CLS observed in Lighthouse audit on the market detail page

## Work Log

- 2026-03-23: Identified by security-sentinel and performance-oracle during code review of feat/video-intelligence-panel
