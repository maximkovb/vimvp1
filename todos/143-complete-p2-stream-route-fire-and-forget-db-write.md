---
name: stream route fire-and-forget DB write is redundant — poll-tiktok already does it
description: /api/tiktok/[videoId]/stream updates videoMetadata in a fire-and-forget write, but poll-tiktok cron already refreshes playUrl every 10 minutes
type: performance
status: pending
priority: p2
issue_id: "143"
tags: [code-review, performance, database, tiktok]
dependencies: []
---

## Problem Statement

`src/app/api/tiktok/[videoId]/stream/route.ts:88-97` fires a `db.update(markets).set({ videoMetadata: ... })` without awaiting it — the comment says "fire-and-forget, don't block the stream". However, `poll-tiktok` cron already refreshes `videoMetadata.playUrl` and thumbnail on every 10-minute cycle. The stream route write is therefore redundant. On a busy feed with N concurrent streams, N fire-and-forget writes compete for the single Neon connection, causing stalls.

## Findings

- **`src/app/api/tiktok/[videoId]/stream/route.ts:88-97`**: redundant fire-and-forget `db.update`
- **`src/app/api/cron/poll-tiktok/route.ts:107-119`**: already updates `videoMetadata.playUrl` and thumbnail on every poll

## Proposed Solutions

### Option A: Delete the fire-and-forget write from the stream route (Recommended)
The poll cron handles this every 10 minutes. A slightly stale playUrl for one 10-minute window is acceptable.
- **Effort:** Tiny (delete 10 lines)
- **Risk:** None — cron covers the update

## Acceptance Criteria
- [ ] No `db.update` in the stream route
- [ ] playUrl still refreshed by poll-tiktok cron on schedule

## Work Log
- 2026-04-06: Identified by performance-oracle during ce:review
