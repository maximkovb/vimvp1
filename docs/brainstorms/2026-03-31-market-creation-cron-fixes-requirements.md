---
date: 2026-03-31
topic: market-creation-cron-fixes
---

# Market Creation & Cron Fixes

## Problem Frame

Two systems are broken after the TikTok-only pivot:

1. **Market creation is stuck.** The admin new-market page (`/admin/markets/new`) fetches video stats correctly (Phase 1), but the Phase 2 contract suggestion call (`computeMarketSuggestion`) was never wired to the UI. `anchorMilestone` is never set, so `contractLoaded` remains `false`, all contract controls are disabled, and the Publish button is permanently greyed out.

2. **Cron is stale.** `vercel.json` still schedules `GET /api/cron/poll-youtube` every 5 minutes — a route that should have been removed during the TikTok pivot. The `poll-tiktok` cron exists and its logic appears correct, but needs verification.

## Requirements

- **R1.** After `fetchVideoStats()` succeeds in `handleFetchVideo()`, the page immediately calls a server action that runs `computeMarketSuggestion` with the returned stats, then populates `anchorMilestone`, `anchorHours`, `riskTier`, `questionType`, and `titleValue` from the result. `contractLoaded` becomes `true` and all contract controls unlock.
- **R2.** If the suggestion call fails (network error, service error), the user sees a clear error message and the form remains usable for manual entry — i.e., the page falls back to unlocking controls with empty/default values rather than staying permanently stuck.
- **R3.** `vercel.json` no longer contains the `poll-youtube` cron entry. The `src/app/api/cron/poll-youtube/` route directory is deleted.
- **R4.** The `poll-tiktok` cron (`GET /api/cron/poll-tiktok`) is confirmed working: it polls active and halted markets every 15 minutes and inserts rows into `tiktok_polls`. Any bugs found during investigation are fixed.
- **R5.** The `poll-tiktok` cron schedule in `vercel.json` is `*/15 * * * *` (every 15 minutes), consistent with the 15-minute internal `shouldPoll` gate.

## Success Criteria

- Admin can paste a TikTok URL, click Fetch, and see the milestone slider and resolution buttons unlock automatically with pre-filled values from the contract suggestion.
- Publish button becomes enabled once resolution window is selected (no manual intervention needed beyond optional tuning).
- `vercel.json` contains no reference to `poll-youtube`.
- `poll-youtube` route directory is absent from `src/app/api/cron/`.
- After a market is active, `tiktok_polls` accumulates new rows roughly every 15 minutes per market.

## Scope Boundaries

- No changes to the contract suggestion algorithm (`computeMarketSuggestion`, `calculateContractRecommendations`) — only the wiring to the UI.
- No changes to the Quick Test market page (`/admin/markets/quick`) — it bypasses the suggestion pipeline intentionally.
- No new polling frequency changes — the 15-minute interval stays as-is.

## Key Decisions

- **Suggestion as a server action, not an API call**: `computeMarketSuggestion` should be exposed as a server action (alongside `fetchVideoStats`) rather than calling the `/api/admin/market-suggestion` Bearer-auth route from the browser. The API route exists for agent/cron callers; the UI should use the server action layer.
- **Graceful suggestion failure**: If suggestion fails, unlock controls with defaults (empty milestone, no resolution selected) rather than blocking the form. The admin can fill in values manually.

## Dependencies / Assumptions

- `computeMarketSuggestion` in `src/lib/services/marketSuggestion.ts` returns `contract.milestoneThreshold`, `contract.resolutionHours`, `contract.riskTier`, and optionally `suggestedTitle`. The `contract` field may be `null` if inputs are insufficient — handle this gracefully.
- TikWM is the only TikTok data source; no other polling infrastructure exists or is planned.

## Outstanding Questions

### Resolve Before Planning
_(none)_

### Deferred to Planning

- [Affects R4][Needs research] Are there any runtime errors in the current `poll-tiktok` cron? Check Vercel function logs or add a test invocation to confirm rows are being written.
- [Affects R1][Technical] Should the suggestion loading state be visually distinct from the stats fetch? (e.g., "Fetching stats… → Generating contract…" two-step indicator) — leave as a planning judgment call.

## Next Steps

→ `/ce:plan` for structured implementation planning
