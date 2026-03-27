---
status: complete
priority: p3
issue_id: "069"
tags: [code-review, agent-native, documentation]
dependencies: ["060", "065"]
---

# AGENTS.md: document the two-phase market creation workflow and calibration fields

## Problem Statement

`AGENTS.md` at the project root currently only contains a Next.js version warning. The two-phase market creation pipeline introduced in this PR — `fetchVideoStats` → `generateMarketSuggestion` → `createMarket` / `POST /api/markets` — is not documented anywhere an agent can discover it.

Specifically, an agent building on this codebase has no way to learn:
- That `channelAvgViews` and `videoAgeHours` affect the calibration floor guard in `createMarket()`
- That omitting these fields causes the floor to degrade to velocity-only
- That `POST /api/markets` lacks the floor guard entirely until todo #060 is resolved
- That draft creation is possible via the API but not the UI
- How to obtain an LLM-generated `suggestedTitle` and calibrated milestone suggestion

## Proposed Content

Add a section to `AGENTS.md` covering:

```markdown
## Market Creation

### Two-phase pipeline
1. **Phase 1 — Video stats** (`fetchVideoStats` server action or `GET /api/admin/video-stats`): returns view count, thumbnail, publishedAt, channelId
2. **Phase 2 — Market suggestion** (`generateMarketSuggestion` server action or `POST /api/admin/market-suggestion`): returns contract recommendation, channelAvgViews, videoAgeHours, suggestedTitle, duplicateWarning
3. **Create** (`POST /api/markets`): accepts milestoneThreshold, resolutionHours, bParameter, questionType, channelAvgViews, videoAgeHours, publishImmediately

### Calibration fields
- `channelAvgViews` — channel's mean views per video (from Phase 2). Omitting defaults to 0, which uses velocity-only floor.
- `videoAgeHours` — age at time of creation. Omitting defaults to 1h, which may produce a floor slightly different from the UI path.

### Draft vs. publish
- `publishImmediately: true` (default in UI): publishes immediately
- `publishImmediately: false` (API default): creates a draft — only accessible via `POST /api/markets`, not through the admin UI form
```

- **Effort**: Small (documentation only)
- **Risk**: Zero

## Acceptance Criteria

- [ ] AGENTS.md documents the three-step market creation pipeline
- [ ] AGENTS.md explains `channelAvgViews` and `videoAgeHours` and their effect on calibration
- [ ] AGENTS.md documents draft vs. publish behaviour asymmetry

## Work Log

- 2026-03-27: Identified during `/ce:review` — agent-native-reviewer (finding #6)
