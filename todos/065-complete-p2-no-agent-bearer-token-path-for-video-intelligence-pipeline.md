---
status: complete
priority: p2
issue_id: "065"
tags: [code-review, agent-native, api]
dependencies: ["060"]
---

# No bearer-token API route for `fetchVideoStats` / `generateMarketSuggestion` — agents can't run the two-phase pipeline

## Problem Statement

Both `fetchVideoStats()` and `generateMarketSuggestion()` are Next.js Server Actions protected by `auth()` + `isAdmin(session)`. This gate works for browser sessions but blocks any agent or cron job that authenticates via `CRON_SECRET` (the bearer-token pattern used by the existing `/api/markets`, `/api/cron/*`, and other API routes).

An agent that wants to create a well-calibrated market via the new two-phase pipeline cannot:
1. Fetch Phase 1 video stats to get a thumbnail and view count
2. Call Phase 2 to get an LLM-generated suggestion with `channelAvgViews`, `videoAgeHours`, and `suggestedTitle`

It can only call `POST /api/markets` directly, which means it must supply all fields manually without access to the LLM calibration or channel analytics. The agent-created market will also lack a proper calibration floor (see todo #060).

## Findings

- `fetchVideoStats` — `src/lib/actions/admin.ts` line 117–119: `auth()` + `isAdmin(session)` check
- `generateMarketSuggestion` — `src/lib/actions/admin.ts` line 164–175: same check
- `POST /api/markets` at `src/app/api/markets/route.ts` uses `CRON_SECRET` bearer-token auth successfully — the pattern exists and works
- Both server actions have typed input/output shapes (`SuggestionResult` return type) that would map cleanly to API request/response bodies

## Proposed Solution

Add two API route handlers protected by `CRON_SECRET`:

1. `GET /api/admin/video-stats?url=<youtubeUrl>` — wraps `fetchVideoStats()`
2. `POST /api/admin/market-suggestion` — wraps `generateMarketSuggestion(videoData)` with the same input shape

The existing session-gated server actions can remain for the browser UI. The API routes are thin wrappers that call the same underlying logic after bearer-token auth:

```typescript
// src/app/api/admin/video-stats/route.ts
export async function GET(req: Request) {
  const auth = req.headers.get("Authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url).searchParams.get("url");
  // ... call fetchVideoStats logic directly (not the server action)
}
```

Note: this requires extracting the core logic of each server action into a pure function that both the server action and the API route can call — the server action stays as a thin auth wrapper.

- **Effort**: Medium
- **Risk**: Low — same logic, different auth mechanism

## Acceptance Criteria

- [ ] `GET /api/admin/video-stats?url=...` returns video stats when called with a valid `CRON_SECRET` bearer token
- [ ] `POST /api/admin/market-suggestion` returns a market suggestion including `suggestedTitle`, `channelAvgViews`, `videoAgeHours` when called with a valid bearer token
- [ ] Both routes return 401 without a valid bearer token
- [ ] AGENTS.md documents both routes with their input/output shapes

## Work Log

- 2026-03-27: Identified during `/ce:review` — agent-native-reviewer (findings #2, #4)
