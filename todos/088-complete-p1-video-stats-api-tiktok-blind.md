---
status: pending
priority: p1
issue_id: "088"
tags: [code-review, tiktok, agent-native, api, parity]
dependencies: []
---

# /api/admin/video-stats YouTube-Only: Agent Cannot Create TikTok Markets

## Problem Statement

The `/api/admin/video-stats` endpoint (used by agents/automation to fetch video metadata before market creation) only handles YouTube URLs. When an agent submits a TikTok URL, the endpoint either errors or returns empty stats — blocking the entire agent-driven TikTok market creation workflow.

This breaks the agent-native parity requirement: any action an admin can take via the UI, an agent must also be able to take via API.

## Findings

From the agent-native-reviewer analysis:
- `POST /api/admin/video-stats` (or equivalent) calls YouTube-specific fetch logic
- No TikTok URL detection or TikAPI call in this route
- Agent workflows that discover TikTok videos cannot proceed past this step
- The admin UI (`src/app/admin/markets/new/page.tsx`) calls `fetchVideoStats` server action which was updated for TikTok — but the API route equivalent was not

## Proposed Solutions

### Option A: Update the API Route to Detect Platform and Route Accordingly
```ts
// In the API route handler:
const platform = isTikTokUrl(videoUrl) ? "tiktok" : "youtube";
if (platform === "tiktok") {
  const videoId = extractTikTokVideoId(videoUrl);
  if (!videoId) return NextResponse.json({ error: "Invalid TikTok URL" }, { status: 400 });
  const stats = await fetchTikTokStatsById(videoId);
  // return normalized response
} else {
  // existing YouTube path
}
```

**Pros:** Full parity with UI flow; unblocks agent workflows
**Effort:** Medium (mirroring the admin action update)
**Risk:** Low

### Option B: Route All Requests Through the Server Action
Refactor the API route to call the same `fetchVideoStats` logic used by the admin action, ensuring a single code path for both UI and API.

**Pros:** Single source of truth; DRY
**Cons:** Server actions are not always directly callable from API routes
**Effort:** Medium

## Recommended Action

Option A — add TikTok detection in the API route using the same pattern as the admin action.

## Technical Details

- **Affected file:** The `/api/admin/video-stats` route (find via `Grep "video-stats" src/app/api`)
- **Imports needed:** `isTikTokUrl`, `extractTikTokVideoId`, `fetchTikTokStatsById` from `@/lib/tiktok`
- **Related:** `src/lib/actions/admin.ts` `fetchVideoStats` — already updated for TikTok, use as reference

## Acceptance Criteria

- [ ] `POST /api/admin/video-stats` with a TikTok URL returns valid stats (viewCount, likeCount, thumbnail, etc.)
- [ ] Invalid TikTok URLs return 400 with a clear error message
- [ ] Existing YouTube behavior unchanged
- [ ] Agent can complete full market creation flow for TikTok video

## Work Log

- 2026-03-29: Identified by agent-native-reviewer agent during TikTok integration code review
