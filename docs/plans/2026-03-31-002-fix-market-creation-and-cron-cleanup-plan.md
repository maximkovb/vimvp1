---
title: Fix Market Creation Suggestion Wiring & Stale YouTube Cron Cleanup
type: fix
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-market-creation-cron-fixes-requirements.md
---

# Fix: Market Creation Suggestion Wiring & Stale YouTube Cron Cleanup

## Overview

Two separate bugs introduced by (or left over from) the TikTok-only platform pivot:

1. **Market creation is permanently stuck.** The admin new-market page fetches video stats correctly but never calls the contract suggestion logic. `anchorMilestone` stays `null`, so `contractLoaded` is always `false`, all contract controls are disabled, and the Publish button can never be clicked.
2. **Vercel cron references a deleted route.** `vercel.json` still schedules `GET /api/cron/poll-youtube` every 5 minutes. The route was removed during the pivot but an empty directory was left behind, and the cron entry was never cleaned up.

## Problem Statement

### Bug 1 — Market creation stuck

`handleFetchVideo()` in `src/app/admin/markets/new/page.tsx` calls `fetchVideoStats()` and sets `videoStats`, but it was designed around a two-phase flow where Phase 2 calls `computeMarketSuggestion` to populate the anchor state. That Phase 2 call was never implemented in the UI. The result:

- `anchorMilestone` is initialized to `null` and only ever reset to `null` (in the reset block at the top of `handleFetchVideo`)
- `contractLoaded = anchorMilestone !== null` → always `false`
- Milestone slider, resolution buttons, and b-parameter input are all `disabled={!contractLoaded}`
- `publishDisabled = !milestoneThreshold || !resolutionHours` → always `true`

The fix: after `setVideoStats(statsResult)` succeeds, call a new `fetchMarketSuggestion` server action, then populate `anchorMilestone`, `anchorHours`, `milestoneThreshold`, `resolutionHours`, `bParameter`, `riskTier`, and (if the result is an LLM recommendation) `titleValue` and `questionType`.

### Bug 2 — Stale cron entry

`vercel.json` contains:
```json
{ "path": "/api/cron/poll-youtube", "schedule": "*/5 * * * *" }
```

The `src/app/api/cron/poll-youtube/` directory exists but is empty (no `route.ts`). Vercel will call this path every 5 minutes and receive a 404. The string `"poll-youtube"` appears nowhere else in the codebase — safe to remove with zero cascade.

## Proposed Solution

### Fix 1 — Add `fetchMarketSuggestion` server action and wire it to the UI

**`src/lib/actions/admin.ts`** — add a new exported server action:

```ts
export async function fetchMarketSuggestion(input: MarketSuggestionInput) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };
  try {
    return await computeMarketSuggestion(input);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Suggestion failed" };
  }
}
```

**`src/app/admin/markets/new/page.tsx`** — extend `handleFetchVideo()`:

After `setVideoStats(statsResult)` succeeds (around line 158), call `fetchMarketSuggestion` with `{ videoId, title, channelTitle, publishedAt, viewCount, likeCount }` from `statsResult`. On success:

```ts
if (result.contract) {
  const c = result.contract;
  setAnchorMilestone(c.milestoneThreshold);
  setAnchorHours(c.resolutionHours);
  setMilestoneThreshold(String(c.milestoneThreshold));
  setResolutionHours(String(c.resolutionHours));
  setBParameter(String(c.bParameter));
  setRiskTier(c.riskTier);
  if (isLLMRecommendation(c)) {
    setTitleValue(c.suggestedTitle);
    setQuestionType(c.questionTypeRecommendation);
  }
}
// If contract is null: unlock controls with defaults (R2 fallback)
setAnchorMilestone(statsResult.viewCount);  // reasonable fallback
setAnchorHours(48);
```

On error (suggestion API fails): show a non-blocking warning and unlock controls with defaults so admin can fill in values manually (see R2).

Add a `isFetchingSuggestion` loading state so the UI shows a two-phase indicator: "Fetching stats… → Generating contract…".

### Fix 2 — Remove stale YouTube cron

- Remove the `poll-youtube` entry from `vercel.json`
- Delete the empty `src/app/api/cron/poll-youtube/` directory

## Technical Considerations

- **Server action import**: `fetchMarketSuggestion` must be imported in `new/page.tsx` alongside `fetchVideoStats`. Add `MarketSuggestionInput` import from `src/lib/services/marketSuggestion.ts` (or re-export via `admin.ts`) and `isLLMRecommendation` from `src/lib/contract.ts`.
- **Suggestion is currently always algorithmic**: `computeMarketSuggestion` always returns `predictionSource: "algorithmic"` — `suggestedTitle` will always be `null` at the top level and `contract` will never be an `LLMContractRecommendation`. The LLM branch should still be handled correctly so it works when LLM path is enabled in future.
- **`suggestedTitle` in `MarketSuggestionResult`**: The top-level `suggestedTitle` field is always `null` in the current implementation. Use `contract.suggestedTitle` (only on `LLMContractRecommendation`) for title pre-fill.
- **`anchorMilestone` fallback**: If `contract` is `null`, a sensible fallback is to use the current view count as anchor so the slider range computes correctly. Set `anchorHours` to 48 as default.
- **`isFetchingSuggestion` state**: Keep separate from `isFetchingStats` so the two phases show distinct loading messages ("Fetching…" → "Generating contract…").

## System-Wide Impact

- **Scope is local**: both fixes are confined to `src/lib/actions/admin.ts`, `src/app/admin/markets/new/page.tsx`, `vercel.json`, and the empty directory. No shared logic, no DB changes, no impact on the public-facing site.
- **`poll-youtube` removal**: no imports exist anywhere — confirmed by grep. Zero cascade.
- **`fetchMarketSuggestion` server action**: adds one function to the already-large `admin.ts` actions file. No impact on other callers of `computeMarketSuggestion` (only `POST /api/admin/market-suggestion` API route uses it, which is unchanged).

## Acceptance Criteria

- [ ] Admin pastes a TikTok URL, clicks Fetch — stats load, then milestone slider and resolution buttons unlock automatically with pre-filled values from the contract suggestion
- [ ] Publish button becomes enabled once resolution window is selected (no manual intervention needed beyond optional tuning of milestone)
- [ ] If `fetchMarketSuggestion` fails, a non-blocking warning is shown and controls unlock with default values — admin can still fill in values manually
- [ ] `vercel.json` no longer contains any reference to `poll-youtube`
- [ ] `src/app/api/cron/poll-youtube/` directory is absent from the repository
- [ ] TypeScript build passes with no errors (`npm run build` or `tsc --noEmit`)
- [ ] The `isFetchingStats` / `isFetchingSuggestion` loading sequence provides clear visual feedback during the two phases

## Dependencies & Risks

- **`computeMarketSuggestion` must not throw for valid inputs**: The current implementation calls `calculateContractRecommendations` and `calculateConfidence` synchronously — no external API calls — so this should be safe. The only async step is the DB duplicate-check query. Wrap in try/catch in the server action (already in the proposed solution).
- **TikWM availability**: `fetchVideoStats` (Phase 1) already handles TikWM errors. The suggestion step (Phase 2) is purely local logic + one DB query, so it's independent of external API availability.

## Files to Change

| File | Change |
|---|---|
| `src/lib/actions/admin.ts` | Add `fetchMarketSuggestion` server action (~15 lines) |
| `src/app/admin/markets/new/page.tsx` | Add `isFetchingSuggestion` state, call `fetchMarketSuggestion` in `handleFetchVideo`, populate anchor state, handle error fallback |
| `vercel.json` | Remove `poll-youtube` cron entry |
| `src/app/api/cron/poll-youtube/` | Delete empty directory |

## Sources

- **Origin document:** [docs/brainstorms/2026-03-31-market-creation-cron-fixes-requirements.md](../brainstorms/2026-03-31-market-creation-cron-fixes-requirements.md)
  - Key decisions carried forward: (1) suggestion exposed as server action not API call, (2) graceful fallback on suggestion failure, (3) `poll-youtube` route and cron entry removed entirely
- `src/lib/actions/admin.ts` — `fetchVideoStats` pattern to follow for `fetchMarketSuggestion`
- `src/lib/services/marketSuggestion.ts` — `computeMarketSuggestion` and `MarketSuggestionInput` types
- `src/lib/contract.ts` — `ContractRecommendation`, `LLMContractRecommendation`, `isLLMRecommendation`
- `src/app/admin/markets/new/page.tsx` — state variables `anchorMilestone`, `anchorHours`, `riskTier`, `titleValue` and their usage
