---
date: 2026-03-22
topic: auto-contract-generation
---

# Auto-Contract Generation for Market Creation

## Problem Frame

When admins create a prediction market, the core contract parameters (`milestoneThreshold`, `bParameter`, and `resolutionHours`) are filled in manually using static defaults (b=100, 72h window). There is no guidance based on the channel's actual analytics. A viral, consistent channel warrants a different contract than an unpredictable one. Currently admins have no signal about risk when setting these values. This feature analyzes channel analytics when the admin fetches video metadata and auto-populates the contract fields with risk-adjusted recommendations the admin can still override.

## Requirements

- R1. **Risk tier assignment** — After the admin fetches video metadata, the system assigns a risk tier (Low / Medium / High) based on a confidence score derived from channel consistency and video performance signals.
- R2. **Auto-generated contract terms** — Each risk tier produces a recommended set of three contract parameters: `milestoneThreshold`, `bParameter`, and `resolutionHours`. Low-risk (high-confidence) markets get aggressive milestones, lower b, and shorter windows. High-risk markets get conservative milestones, higher b, and standard windows.
- R3. **Auto-populated form fields** — When the admin fetches video metadata, the existing form fields for milestone threshold, liquidity (b), and resolution window are pre-filled with the recommended values. A risk tier badge is shown alongside the video preview.
- R4. **Admin override** — Admins can edit any of the three pre-filled fields before submitting. The form submits whatever the admin has in the fields at submission time.
- R5. **Extended fetch action** — `fetchVideoMetadata` (or a new action it delegates to) also fetches channel subscriber count and recent video view counts to compute the confidence score and contract recommendations. These are returned alongside the existing video preview data.

## Success Criteria

- Risk tier badge is displayed for every successfully fetched video.
- `bParameter` and `resolutionHours` form fields are no longer always the static defaults (100, 72h) — they vary by channel risk.
- High-confidence channels produce observably different contract terms than low-confidence channels.
- Admin can see the recommended values and change them before creating.

## Scope Boundaries

- Risk tier is based solely on channel analytics fetched at preview time — no stored historical data, no ML models.
- Contract parameters only apply at creation time — no mechanism to update them after a market is active.
- No player-facing exposure of risk tier or contract reasoning — admin-only feature.
- No changes to the `createMarket` server action signature — it already accepts all three fields via FormData.

## Key Decisions

- **Contract parameters**: `milestoneThreshold`, `bParameter`, and `resolutionHours` — all three are risk-adjusted and already editable in the existing form.
- **Risk signal**: Confidence score derived from channel view variance + video age (computed fresh on each fetch — no stored confidence).
- **Override UX**: Auto-populate existing form fields (no new Contract section needed since fields already exist); add risk badge next to video preview.

## Dependencies / Assumptions

- `fetchVideoMetadata` currently makes one YouTube API call. Adding channel analytics requires 2 additional calls (channel stats + recent video list + batch stats). This triples API usage per fetch — acceptable for an admin-only tool.
- The `resolutionHours` field is a `<select>` with fixed options (24/48/72/168). Auto-population must choose from these values, not arbitrary hours.
- `createMarket` already reads `bParameter`, `resolutionHours`, and `milestoneThreshold` from FormData — no changes needed there.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] What confidence thresholds map to Low / Medium / High? Planning should propose starting values calibrated to the project's existing defaults (b=100, 72h).
- [Affects R2][Technical] What are the starting `bParameter` and `resolutionHours` values per tier? (Existing form defaults: b=100, resolutionHours=72.)
- [Affects R2][Technical] How should `milestoneThreshold` be computed per tier? No scoring infrastructure exists yet in this codebase.
- [Affects R5][Technical] Should `fetchVideoMetadata` be extended in-place or should a new action `fetchVideoWithAnalysis` be added? Extending in-place keeps the call site unchanged; a new action is cleaner if the return type changes significantly.
- [Affects R3][Technical] The existing form fields are uncontrolled HTML inputs. Auto-populating them requires converting to controlled inputs (React state) or using a key-based re-render trick. Planning should pick the approach.

## Next Steps

→ `/ce:plan` for structured implementation planning
