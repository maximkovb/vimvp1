---
status: pending
priority: p1
issue_id: "087"
tags: [code-review, tiktok, cron, vercel, config]
dependencies: []
---

# poll-tiktok Cron Route Not Registered in vercel.json

## Problem Statement

`src/app/api/cron/poll-tiktok/route.ts` was created but never added to `vercel.json`. Without the `vercel.json` entry, Vercel never schedules the cron — TikTok markets will never have their stats updated, and all TikTok markets will sit frozen at their initial view counts.

This is a silent failure: the code exists and works, but is never invoked in production.

## Findings

Current `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/poll-youtube", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/resolve-markets", "schedule": "*/5 * * * *" }
  ]
}
```

`/api/cron/poll-tiktok` is absent. TikAPI recommends 15-minute polling intervals; the plan specifies `*/15 * * * *`.

## Proposed Solutions

### Option A: Add Entry to vercel.json (Only Option)
```json
{
  "crons": [
    { "path": "/api/cron/poll-youtube", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/poll-tiktok", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/resolve-markets", "schedule": "*/5 * * * *" }
  ]
}
```

**Pros:** Required for the feature to function
**Effort:** Trivial (2-line JSON change)
**Risk:** None

## Recommended Action

Add the entry. Schedule `*/15 * * * *` (every 15 min) as specified in the plan, matching TikAPI's recommendation and staying well within the rate limit even with many markets.

## Technical Details

- **Affected file:** `vercel.json`
- **Schedule:** `*/15 * * * *` (every 15 minutes)
- **Dependency:** Should be done after todo #086 (maxDuration) is resolved

## Acceptance Criteria

- [ ] `vercel.json` includes `/api/cron/poll-tiktok` with `*/15 * * * *` schedule
- [ ] Cron invocation verified in Vercel dashboard after deploy
- [ ] TikTok market stats update every 15 minutes in production

## Work Log

- 2026-03-29: Identified by performance-oracle agent during TikTok integration code review
