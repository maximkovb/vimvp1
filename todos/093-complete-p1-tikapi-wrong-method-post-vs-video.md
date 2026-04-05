---
status: pending
priority: p1
issue_id: "093"
tags: [code-review, tiktok, typescript, bug]
dependencies: []
---

# TikAPI Calls Wrong Endpoint: `api.public.post` Should Be `api.public.video`

## Problem Statement

`fetchTikTokStatsById` in `src/lib/tiktok.ts` calls `(api.public as any).post({ id: videoId })`. According to the `tikapi` npm package's TypeScript definitions, `api.public.post` is the **comment-posting endpoint**, not a video info endpoint. The correct method for fetching video stats by ID is `api.public.video({ id: videoId })`.

The `any` cast was masking this API mismatch at compile time. Every TikTok stat fetch is hitting the wrong endpoint — video stats are never actually retrieved.

## Findings

From `src/lib/tiktok.ts` line 60:
```ts
const response = await (api.public as any).post({ id: videoId });
```

From `tikapi` type definitions (`node_modules/tikapi/api.d.ts`):
- `api.public.video` (line ~215): accepts `{ id?: string }` — video info endpoint
- `api.public.post` (line ~1339): comment/post endpoint — wrong

The correct call:
```ts
const response = await api.public.video({ id: videoId });
```

This also eliminates the `any` cast entirely — `api.public.video` is fully typed in the SDK.

## Proposed Solutions

### Option A: Fix Method Name + Remove Cast (Only Option)
```ts
// Before
const response = await (api.public as any).post({ id: videoId });

// After
const response = await api.public.video({ id: videoId });
```

Then verify the response shape matches the `item.stats.playCount` path used in the existing parsing logic. The `ResponseObject.json` returned by `api.public.video` contains `itemInfo.itemStruct` — confirm the field mapping is correct against the TikAPI sandbox or docs.

**Effort:** Small
**Risk:** Requires verifying response shape after method name fix

## Recommended Action

Fix the method name and remove the cast. Then test against a real TikTok video ID to confirm `item.stats.playCount` exists in the response.

## Technical Details

- **Affected file:** `src/lib/tiktok.ts`, line 60
- **Change:** `(api.public as any).post` → `api.public.video`
- **Impact:** Every TikTok market stat fetch currently hits the wrong API endpoint

## Acceptance Criteria

- [ ] `fetchTikTokStatsById` calls `api.public.video({ id: videoId })`
- [ ] No `any` cast on the API call
- [ ] Response parsing produces non-null stats for a valid TikTok video ID
- [ ] TypeScript compiles cleanly with no type assertions on the API call

## Work Log

- 2026-03-29: Identified by kieran-typescript-reviewer during TikTok integration code review
