---
status: pending
priority: p2
issue_id: "097"
tags: [code-review, typescript, tiktok, admin]
dependencies: []
---

# Admin Page: Replace `"in"` Narrowing with Platform Discriminant

## Problem Statement

`src/app/admin/markets/new/page.tsx` accesses TikTok-only fields on `videoStats` using JavaScript `"in"` operator checks with inline type assertions:

```tsx
value={"creatorId" in (videoStats ?? {}) ? (videoStats as { creatorId?: string }).creatorId ?? "" : ""}
```

`VideoStatsSuccess` is a discriminated union on the `platform` field — TypeScript can narrow it completely with `videoStats?.platform === "tiktok"`. The `"in"` pattern bypasses the type system and requires manual assertions that won't catch future type changes. It also makes the intent less clear.

## Findings

From `src/app/admin/markets/new/page.tsx` lines 370–371:
```tsx
<input type="hidden" name="creatorId"
  value={"creatorId" in (videoStats ?? {}) ? (videoStats as { creatorId?: string }).creatorId ?? "" : ""} />
<input type="hidden" name="tikapiPostId"
  value={"tikapiPostId" in (videoStats ?? {}) ? (videoStats as { tikapiPostId?: string }).tikapiPostId ?? "" : ""} />
```

`fetchVideoStats` returns `platform: "tiktok" as const` or `platform: "youtube" as const` — making `platform` a valid discriminant. After narrowing on `platform === "tiktok"`, TypeScript knows the full TikTok shape and `creatorId`/`tikapiPostId` are accessible without any assertion.

## Proposed Solutions

### Option A: Narrow on Platform Discriminant (Recommended)
```tsx
<input type="hidden" name="creatorId"
  value={videoStats?.platform === "tiktok" ? videoStats.creatorId ?? "" : ""} />
<input type="hidden" name="tikapiPostId"
  value={videoStats?.platform === "tiktok" ? videoStats.tikapiPostId ?? "" : ""} />
```

No assertions, no `(videoStats ?? {})` hack, TypeScript-safe.

**Pros:** Idiomatic discriminated union narrowing; compiler-verified
**Effort:** Trivial (2-line change)
**Risk:** None — behavior identical, type safety improved

## Recommended Action

Option A — straightforward replacement.

## Technical Details

- **Affected file:** `src/app/admin/markets/new/page.tsx`, lines 370–371
- **Pattern:** Replace `"field" in (x ?? {}) ? (x as {...}).field` with `x?.platform === "tiktok" ? x.field`

## Acceptance Criteria

- [ ] No `as { creatorId?: string }` or similar assertions in `page.tsx`
- [ ] `videoStats?.platform === "tiktok"` used as the discriminant
- [ ] TypeScript compiles cleanly with `strict: true`
- [ ] Behavior of hidden fields unchanged

## Work Log

- 2026-03-29: Identified by kieran-typescript-reviewer during TikTok integration code review
