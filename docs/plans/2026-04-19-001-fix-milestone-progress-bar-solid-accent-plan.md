---
title: "fix: Milestone progress bar solid accent color"
type: fix
status: active
date: 2026-04-19
---

# fix: Milestone progress bar solid accent color

## Overview

The milestone progress bar in `FeedCard.tsx` currently renders as a split green/red fill driven by `priceYes`/`priceNo` probabilities. This PR changes it to a single solid fill using the app's accent blue (`--accent: #4169e1`) to match the rest of the UI's accent language.

## Problem Frame

The split green/red rendering was designed to communicate trading probability inline. The product preference is for the bar to simply show milestone progress (how far toward the target) in the same accent blue used for buttons, links, and other interactive accents — keeping the yes/no data only in the labels below the bar.

## Requirements Trace

- R1. Progress bar fill is a single solid color matching `--accent` (#4169e1)
- R2. Fill width represents overall milestone progress (`displayFill * 100%`), not the yes/no probability split
- R3. Yes/No probability data is preserved in the tap tooltip and always-visible labels

## Scope Boundaries

- Only the visual fill color and width logic of the bar track changes
- The animation phases (idle → pending → filling → done), the user-position tick, and the label/tooltip content are unchanged

## Context & Research

### Relevant Code and Patterns

- `src/components/FeedCard.tsx` lines 175–189: current two-div yes/no fill implementation
- `src/app/globals.css` line 11: `--accent: #4169e1` wired into Tailwind as `bg-accent` via `@theme inline`
- Other usages of `bg-accent` exist throughout the codebase for consistent accent coloring

## Key Technical Decisions

- **Single div replacing two divs**: Removes the yes/no split entirely from the bar track. Width becomes `displayFill * 100%` directly.
- **Use `bg-accent` Tailwind class**: Consistent with how the accent color is applied everywhere else; no inline style needed for color.

## Implementation Units

- [ ] **Unit 1: Replace yes/no split fill with solid accent fill**

**Goal:** Remove the two green/red fill divs and replace with a single `bg-accent` div spanning `displayFill * 100%`

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `src/components/FeedCard.tsx`

**Approach:**
- Delete the YES fill div (lines ~176–180) and NO fill div (lines ~181–189)
- Insert a single div: `className="absolute left-0 top-0 h-full bg-accent"` with `style={{ width: \`${displayFill * 100}%\`, transition: transitionStyle }}`
- The `priceYes`/`priceNo` props are still consumed by the tooltip and labels (lines 206–214), so they remain in the props signature and are not removed

**Patterns to follow:**
- `bg-accent` usage in other components for accent color application

**Test scenarios:**
- Happy path: bar fills to `fillPct * 100%` in accent blue for a market with valid `current` and `target`
- Edge case: `current === null` or `target === 0` → `isEmpty` branch shows pulse skeleton, no accent fill renders
- Edge case: `fillPct` capped at 1.0 → bar never exceeds 100% width
- Happy path: yes/no percentages still appear correctly in tap tooltip and always-visible labels after the fill change

**Verification:**
- The bar track shows a single solid blue fill with no green or red
- Hovering/tapping shows the tooltip still displays YES/NO probabilities
- Animation phases (fill sweep, live update transition) still behave correctly

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `priceYes`/`priceNo` props appear unused after the change if a linter complains | They are still referenced in tooltip/label JSX below the bar track — no removal needed |

## Sources & References

- Related code: `src/components/FeedCard.tsx` lines 102–219
- Color definition: `src/app\globals.css` line 11
