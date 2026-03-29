---
date: 2026-03-23
topic: market-creation-proportional-controls
---

# Market Creation: Proportional Milestone & Resolution Controls

## Problem Frame

Admins creating markets currently accept the AI's recommended `milestoneThreshold` and `resolutionHours` as-is or edit them in isolation. There's no affordance for adjusting one parameter while keeping the contract's implied difficulty proportionally consistent. A slider for the milestone and option buttons for the resolution window — each linked to the other — would let admins tune contracts quickly and confidently.

## Requirements

- **R1.** Replace the `milestoneThreshold` number input with a slider control. The slider displays the current value and allows the admin to drag it to a new target.
- **R2.** Replace the `resolutionHours` select with a set of option buttons (pill/toggle style): **24h · 48h · 72h · 7d**.
- **R3.** When the AI recommendation is loaded, both controls are seeded from the recommendation. The recommended values are stored as an anchor (immutable reference point for ratio calculations).
- **R4.** When the admin moves the milestone slider, the resolution hours are recalculated proportionally relative to the anchor: `newHours = anchorHours × (newViews / anchorViews)`.
- **R5.** When the admin clicks a resolution option button, the milestone threshold is recalculated proportionally: `newViews = anchorViews × (newHours / anchorHours)`.
- **R6.** The milestone slider's range is derived from two constraints: minimum = `max(0.1× anchor, currentAnalytics × 1.20)`, maximum = 5× anchor (both rounded to a clean integer). The 1.20× floor ensures the target is always meaningfully above the video's current analytics at the time of market creation. The slider should snap to sensible step increments (e.g. 1k or 10k depending on magnitude).
- **R7.** The current milestone value is always shown as a readable number alongside the slider (formatted with locale commas).
- **R8.** Both controls are disabled / show a loading state before the AI recommendation is loaded (same as current behavior for the number inputs).
- **R9.** The `bParameter` (liquidity) field is unchanged — it does not participate in proportional adjustment.
- **R10.** The video's current analytics value (view count or like count, matching the active `questionType`) is fetched when the video is loaded and displayed as a read-only reference near the milestone slider (e.g. "Current: 84.2k views"). This gives the admin visibility into the 20% floor constraint.
- **R11.** The `questionType` defaults to "views" when the market creation form loads.

## Success Criteria

- An admin can fetch a video, see the AI recommendation seeded into the slider and option buttons, and drag the slider or click a different time option to instantly see the other value update.
- The adjusted values are what actually get submitted to `createMarket`.
- The change feels fluid — no page navigation, no re-fetch required.

## Scope Boundaries

- No changes to the AI prediction logic or `bParameter` behavior.
- The `questionType` (views vs likes) select control is out of scope beyond defaulting to "views" (R11) — its interaction with proportional controls is not in scope.
- Mobile responsiveness is not a stated requirement; match the existing form's responsive behavior.
- No undo/reset-to-AI-recommendation button in scope (could be a fast follow).

## Key Decisions

- **Linear ratio scaling chosen over logarithmic:** The AI recommendation is already a processed output (not raw formula values), so inverting the logarithmic projection formula would introduce inconsistency. Simple ratio scaling is predictable for admins: "2× views → 2× time."
- **Anchor is the AI recommendation:** Adjustments are always relative to the original AI-suggested values, not the current slider position. This prevents drift compounding across multiple adjustments.
- **Snap to nearest preset when slider drives hours:** When dragging the milestone slider produces a non-preset hours value, snap to the nearest of [24, 48, 72, 168] and highlight that option button. Keeps resolution within the existing system presets.

## Outstanding Questions

### Resolve Before Planning

_(none — all blocking questions resolved)_

### Deferred to Planning

- **[Affects R6][Technical]** Determine appropriate slider step size logic: likely `10^(floor(log10(anchorViews)) - 1)` to keep steps at 1/10th the order of magnitude of the anchor. Validate in planning.
- **[Affects R1, R2][Needs research]** Confirm the current form uses shadcn/ui or plain Tailwind — choose slider primitive accordingly (shadcn `Slider` vs custom range input).
- **[Affects R6, R10][Technical]** Confirm whether `currentAnalytics` (the video's live view/like count) is already returned by the video fetch endpoint used in this form, or requires a separate lookup. If separate, determine where in the fetch flow to attach it.

## Next Steps
→ `/ce:plan` for structured implementation planning.
