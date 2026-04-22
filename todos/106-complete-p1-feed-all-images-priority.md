---
status: pending
priority: p1
issue_id: "106"
tags: [code-review, performance, feed]
dependencies: []
---

# Remove `priority` from all but first 1–2 FeedCard images

## Problem Statement

Every `FeedCard` renders `<Image fill priority>`. The `priority` prop injects a `<link rel="preload">` for each image and disables lazy loading. With up to 50 cards in the feed, the browser receives 50 simultaneous preload hints and decodes all thumbnails at paint time — approximately 65 MB of GPU texture memory — even though only 1 card is visible.

## Findings

- `src/components/FeedCard.tsx:119`: `<Image src={...} fill priority />` — `priority` unconditional
- `src/components/DiscoverFeed.tsx:117`: no `index` prop passed to `FeedCard`
- Performance agent: ~1.3 MB GPU per full-viewport image × 50 = ~65 MB at paint time
- Delays LCP for the first visible card because it competes for bandwidth with 49 other preloads
- Next.js docs: `priority` is intended only for the LCP image (at most the first 1–2 above-the-fold items)

## Proposed Solutions

### Option 1: Pass `index` from DiscoverFeed, set `priority` only for first 2

**Approach:**

```tsx
// DiscoverFeed.tsx
{feedMarkets.map((market, index) => (
  <div key={market.id} className="snap-start h-screen">
    <FeedCard ... priority={index < 2} />
  </div>
))}

// FeedCard.tsx
interface FeedCardProps { ...; priority?: boolean; }
<Image ... priority={priority} />
```

**Pros:** First card still gets optimal LCP treatment; all others lazy-load as they scroll into view
**Cons:** None

**Effort:** 20 minutes
**Risk:** Low

## Recommended Action

Pass `priority` prop from `DiscoverFeed` (true only for `index < 2`) and thread through to the `<Image>` in `FeedCard`.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:119` — add `priority` prop, conditionally apply
- `src/components/DiscoverFeed.tsx:117-130` — pass `priority={index < 2}`

## Acceptance Criteria

- [ ] Only the first 2 feed cards emit `<link rel="preload">` for their thumbnails
- [ ] Cards beyond index 1 lazy-load thumbnails as they snap into view
- [ ] No visible LCP regression on the first card

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (performance-oracle agent)
