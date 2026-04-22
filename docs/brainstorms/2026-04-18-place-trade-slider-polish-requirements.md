---
date: 2026-04-18
topic: place-trade-slider-polish
---

# Place a Trade — Slider & Amount Input Polish

## Problem Frame

The current "Place a Trade" UI (`src/components/TradePanel.tsx` + `src/components/CoinSlider.tsx`) uses a plain native range input (browser default "ball-in-tube" style) and fixed-amount preset buttons (10, 25, 50, 100 coins). Users cannot type an exact amount, the slider visually feels unpolished, and the presets are absolute values that don't scale with wallet size. The goal is a clean, wallet-relative trading control that matches the UX quality of perpetuals trading UIs (e.g. Axiom).

## Requirements

**Amount Input**
- R1. Add a coin amount text input field adjacent to or above the slider. The input accepts integers only.
- R2. The input and slider are bidirectionally synced: changing the input moves the slider; dragging the slider updates the input.
- R3. When the typed value exceeds the user's wallet balance, clamp the value to the balance and briefly flash a "Not enough coins" inline error (auto-dismiss after ~1.5s).
- R4. The input should accept partial typed values mid-entry (e.g., typing "1" then "0" to reach "10") without snapping on every keystroke — only sync/clamp on blur or Enter.

**Slider Redesign**
- R5. Replace the native `<input type="range">` with a custom slider: a draggable ball on a plain horizontal line (no filled track "tube").
- R6. The line has visible snap point markers at **10%, 25%, 50%, 75%, and 100%** of the user's wallet balance, with percentage labels below each marker.
- R7. Clicking or tapping a snap point label or marker sets the amount to that percentage of the wallet balance (rounded to the nearest integer, minimum 1).
- R8. The percentage snap point markers replace the current fixed-amount preset buttons (10, 25, 50, 100).

**Balance Awareness**
- R9. The slider max and all percentage snap points must be computed from the user's actual wallet balance, not the hardcoded fallback of 500. The balance should be sourced from the existing `/api/balance` SWR key to avoid duplicate requests.
- R10. If balance is still loading (e.g., on first open), the slider and input are disabled until balance resolves. `BetSheet` must propagate both the resolved balance value and an explicit loading state to `TradePanel` so the component can distinguish "loading" from "no prop provided".

**Responsive**
- R11. The control must work and look correct on both mobile (bottom-sheet context in `BetSheet`) and desktop.

## Success Criteria
- A user can type "137" in the input and see the slider ball position update to 137/balance along the line.
- Clicking the "25%" snap marker sets the input to `Math.round(balance * 0.25)`.
- Typing a number above the balance clamps it and shows a brief error.
- The slider has no visible filled-track tube — just a ball on a line with labeled snap points.

## Scope Boundaries
- No changes to the trade submission logic, LMSR math, staleness detection, or Buy button behavior.
- No changes to the YES/NO outcome selector.
- No changes to BetSheet layout beyond what's needed to thread balance into TradePanel.
- The sell flow (`SellButton`) is out of scope.

## Key Decisions
- **Clamp + flash error on over-balance input**: Clamp the value to balance and show a brief "Not enough coins" message (auto-dismiss). Keeps the UI clean without a persistent error state.
- **Percentage snap points replace fixed presets**: Wallet-relative percentages are more universally useful than fixed coin amounts, especially as balances grow.
- **Ball-on-line, no filled track**: Matches the clean Axiom-style aesthetic and avoids the visually heavy native browser slider.

## Dependencies / Assumptions
- `BetSheet` must pass the resolved wallet balance into `TradePanel` (currently `userBalance` prop is optional and falls back to 500; BetSheet doesn't pass it). Planning should use the existing `/api/balance` SWR cache rather than adding a new fetch.
- The SWR key `/api/balance` is already used by `BalanceChip` — reusing it keeps request count at zero added.

## Outstanding Questions

### Deferred to Planning
- [Affects R9][Technical] Should `BetSheet` fetch balance via SWR and pass it as `userBalance` to `TradePanel`, or should `TradePanel` fetch it internally? Either works; pick whichever keeps the prop interface cleaner.
- [Affects R5–R6][Technical] Custom slider implementation: verify Tailwind + existing CSS conventions before choosing between a pure CSS/JS solution and a headless UI library component.

## Next Steps
-> `/ce:plan` for structured implementation planning
