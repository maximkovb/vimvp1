---
date: 2026-04-18
topic: mobile-bet-expandable-tray
---

# Mobile: Expandable "Make Prediction" Tray

## Problem Frame

On mobile, the YES and NO bet buttons at the bottom of `FeedCard` are obscured by the device navigation bar. The bottom overlay already competes for vertical space with the milestone progress bar, scrubber, title, and target text. Replacing the always-visible YES/NO pair with a single collapsed trigger removes the nav-bar clash and reduces visual noise while scrolling — the user only expands the bet controls when they intend to act.

## Requirements

- R1. On mobile (`< 1024px`), the YES and NO buttons are removed from the default (collapsed) state. In their place is a single full-width pill button labeled **"Make Prediction"** with an upward chevron/arrow icon.
- R2. Tapping "Make Prediction" expands the tray: the pill is replaced in-place by the YES and NO buttons (same styling and behavior as the current buttons, including prices and `onTap(0)` / `onTap(1)` calls).
- R3. Tapping YES or NO in the expanded state calls `onTap` as today (opens BetSheet) and collapses the tray back to the "Make Prediction" pill.
- R4. The "Make Prediction" pill is hidden (not rendered) when the market is not trading (`status !== "active"`), matching the existing behavior where YES/NO buttons are disabled for non-active markets. Non-trading state shows nothing in that slot.
- R5. The tray respects the existing density system: in `minimal` density the "Make Prediction" pill is hidden (matching the current `DENSITY_BUTTON_STYLE` behavior). In `compact` and `full` density it is visible.
- R6. When the card is deactivated (user scrolls away), the tray collapses back to the "Make Prediction" pill if it was expanded.
- R7. Desktop layout (`≥ 1024px`) is entirely unchanged.

## Success Criteria

- The YES/NO buttons are not visible in the default scroll state on mobile — only the pill is shown.
- The navigation bar no longer obscures the bet UI.
- Tapping "Make Prediction" reveals YES and NO; tapping either places a bet and collapses the tray.
- Desktop layout is unaffected.

## Scope Boundaries

- Mobile only (`lg:hidden` block in `FeedCard`).
- No changes to BetSheet, TradePanel, or the bet placement flow itself.
- No animation required for the expand/collapse (instant toggle, matching the existing density transitions approach).
- The milestone progress bar and scrubber visibility are unchanged by this feature.

## Key Decisions

- **Label**: "Make Prediction" (not "Place Bet" or "YES / NO") — user preference.
- **Collapsed state shows pill**: One button, not zero — gives users a clear affordance to act without the buttons always consuming space.
- **Collapse on bet**: Tapping YES or NO collapses the tray, since BetSheet opens and covers the card anyway.
- **Collapse on deactivate**: Ensures a clean state when the user scrolls back to a card.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Should the expand/collapse use a local `useState` in `FeedCard`, or extend the existing `densityState` mechanism? A new local boolean is likely simpler and more explicit.
- [Affects R4][Technical] Confirm whether the non-trading slot should show nothing at all or a disabled/greyed "Make Prediction" pill — current YES/NO uses disabled styling; confirm preferred treatment with current code.

## Next Steps

→ `/ce:plan` for structured implementation planning
