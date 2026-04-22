---
status: pending
priority: p3
issue_id: "100"
tags: [code-review, simplification, tiktok, yagni]
dependencies: []
---

# Simplification: Dead Code and YAGNI Violations in TikTok Integration

## Problem Statement

The TikTok integration introduced several pieces of speculative or dead code that add schema/maintenance weight without delivering features. These should be cleaned up.

## Findings

From `code-simplicity-reviewer`:

### 1. `TIKTOK_VIDEO_ID_RE` in constants is never imported
`src/lib/constants.ts` line 16 exports `TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/`. The same regex is inlined in `extractTikTokVideoId` in `tiktok.ts`. The constant export is never imported anywhere. Dead export.

### 2. `tiktokPolls.commentCount` and `shareCount` are never read
These columns are declared in `schema.ts` and inserted as `null` in `createMarket`. The oracle reads only `viewCount`/`likeCount`. The market page drops them. They add schema weight without delivering any feature.

### 3. Redundant `TIKAPI_KEY` check in `poll-tiktok/route.ts`
Lines 26–32 check `process.env.TIKAPI_KEY` and return 500 before the market loop. `getClient()` in `tiktok.ts` also throws if the key is absent, caught per-market by the error handler. The early check is redundant.

### 4. `oracle.ts` explicit annotation — use select projections
The `let latestPoll: { viewCount: bigint | null; likeCount: bigint | null } | undefined` annotation exists because both branches return full rows. Switching to explicit `select({ viewCount, likeCount })` projections lets inference work without annotation.

## Proposed Solutions

### Fix Each Item Individually

**1. Remove `TIKTOK_VIDEO_ID_RE` from constants.ts** (or use it in `tiktok.ts` and remove the inline duplicate)

**2. Remove `commentCount` and `shareCount` from `tiktokPolls`**
Keep them as nullable in the migration only if there's a concrete plan to display them. Otherwise drop them now before the migration is applied.

**3. Remove redundant TIKAPI_KEY check from `poll-tiktok/route.ts` lines 26–32**

**4. Use select projections in `oracle.ts` for the poll queries** to eliminate the explicit type annotation

## Effort

- Items 1, 3: Trivial (delete 1-7 lines each)
- Item 2: Small (schema + migration change)
- Item 4: Small (2 query rewrites)

## Acceptance Criteria

- [ ] `TIKTOK_VIDEO_ID_RE` either used consistently (imported by `tiktok.ts`) or removed from constants
- [ ] `tiktokPolls.commentCount` and `shareCount` removed (or kept with documented intent)
- [ ] Redundant key check removed from `poll-tiktok/route.ts`
- [ ] `oracle.ts` poll queries use column projections; explicit `latestPoll` type annotation removed

## Work Log

- 2026-03-29: Identified by code-simplicity-reviewer during TikTok integration code review
