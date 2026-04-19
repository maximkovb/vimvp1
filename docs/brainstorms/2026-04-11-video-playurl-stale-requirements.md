---
date: 2026-04-11
topic: video-playurl-stale
---

# Video Play URL Stale After Server Restart

## Problem Frame
After a server restart (or after ~24h), the TikWM CDN-signed `playUrl` stored in `videoMetadata` in the DB has expired. The market page and feed serve this stale URL to clients. The client-side `onError` recovery (which refetches via `/api/tiktok/[videoId]/play-url`) is unreliable — some browsers/CDN failure modes don't fire the video element's error event — leaving some markets with permanently blank video areas.

## Requirements
- R1. The `playUrl` in `videoMetadata` must be kept fresh so that clients always receive a non-expired URL on initial page load.
- R2. The fix must not introduce meaningful additional latency to page renders.

## Success Criteria
- After a server restart, all market videos load on first render without requiring the `onError` fallback.
- Blank video areas caused by expired `playUrl` are eliminated.

## Scope Boundaries
- The client-side `onError` recovery remains as a secondary fallback — no changes needed there.
- Markets in terminal states (resolved, cancelled) are out of scope — they don't appear in the feed.

## Key Decisions
- **Persist `playUrl` in the poll-tiktok cron**: The cron already fetches fresh stats (including `playUrl`) every 10 minutes for active/halted markets. It currently persists the updated `thumbnail` but not `playUrl`. Extending it to also persist `playUrl` is the minimal, natural fix with no added latency to page renders. This keeps the URL at most ~10 minutes old — well within the 24h expiry.

## Next Steps
→ `/ce:work` — proceed directly; fix is a one-file change to `src/app/api/cron/poll-tiktok/route.ts`
