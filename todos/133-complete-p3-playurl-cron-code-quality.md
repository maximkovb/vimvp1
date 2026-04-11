---
status: pending
priority: p3
issue_id: "133"
tags: [code-review, quality]
dependencies: []
---

# poll-tiktok videoMetadata update: minor code quality improvements

## Problem Statement

Three small code quality issues in the new `videoMetadata` update block in `src/app/api/cron/poll-tiktok/route.ts`. None are bugs; all are clarity and idiom improvements.

## Findings

**TypeScript reviewer:**

1. **`stats.playUrl || undefined` should be an explicit empty-string guard.**
   `||` converts any falsy value to undefined. For a `string` field that is "never null but can be `""`", the explicit form is clearer:
   ```ts
   // Before
   const newPlayUrl = stats.playUrl || undefined;
   // After
   const newPlayUrl = stats.playUrl !== "" ? stats.playUrl : undefined;
   ```

2. **`stats !== null` check is likely redundant.**
   The same guard is already applied two blocks above (for the poll insert). TypeScript may already narrow `stats` to non-null at this point. Verify by removing the check and running `tsc --noEmit`. If no error, delete the guard. If an error, add a comment explaining why it's needed.

3. **Conditional spread is noisy.**
   `...(newThumbnail !== undefined ? { thumbnail: newThumbnail } : {})` can be simplified to `...(newThumbnail && { thumbnail: newThumbnail })` since both variables are `string | undefined` (never `0`, `false`, etc.). Flagged by both the TypeScript reviewer and the simplicity reviewer.

4. **Fallback object lacks a comment.**
   `{ title: "", thumbnail: "", channelTitle: "" }` exists solely to satisfy TypeScript's required fields on `VideoMetadata`. A comment would prevent future readers from thinking this is a real business case:
   ```ts
   // Type-satisfaction fallback — markets always have videoMetadata set before the cron polls them
   ...(market.videoMetadata ?? { title: "", thumbnail: "", channelTitle: "" }),
   ```

## Proposed Solutions

Apply all four inline — small, independent changes in `src/app/api/cron/poll-tiktok/route.ts`.

**Effort:** Small (< 30 min). **Risk:** Very low (no behavioral change).

## Acceptance Criteria
- [ ] `stats.playUrl || undefined` replaced with `stats.playUrl !== "" ? stats.playUrl : undefined`
- [ ] `stats !== null` guard verified via `tsc --noEmit`: removed if redundant, commented if needed
- [ ] Conditional spread simplified to `...(x && { key: x })` pattern
- [ ] Fallback object has a comment explaining its purpose
- [ ] `tsc --noEmit` still passes after all changes

## Work Log
- 2026-04-11 — Created from ce:review of `fix(cron): refresh playUrl in poll-tiktok alongside thumbnail`
