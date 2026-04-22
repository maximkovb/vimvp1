---
title: "feat: Polish Place a Trade — custom slider + bidirectional amount input"
type: feat
status: active
date: 2026-04-18
origin: docs/brainstorms/2026-04-18-place-trade-slider-polish-requirements.md
---

# feat: Polish Place a Trade — custom slider + bidirectional amount input

## Overview

Replace the native `<input type="range">` "ball-in-tube" slider with a custom draggable ball on a plain line, add snap markers at wallet-percentage breakpoints, add a bidirectional coin text input, and wire the user's actual wallet balance into the trade control. This removes the 500-coin hardcoded fallback and makes all snap points wallet-relative.

## Problem Frame

The current "Place a Trade" UI (`src/components/TradePanel.tsx` + `src/components/CoinSlider.tsx`) uses a native browser range input and fixed-amount preset buttons [10, 25, 50, 100 coins]. Users cannot type an exact amount, the slider looks unpolished, and the slider max ignores the user's actual balance (hardcoded to 500). The goal is a clean, wallet-aware trading control matching the quality of perpetuals UIs (e.g. Axiom). See origin doc for full requirements.

## Requirements Trace

- R1. Add a coin text input field — integers only
- R2. Bidirectional sync: input ↔ slider
- R3. Over-balance input: clamp to balance + flash "Not enough coins" (~1.5s auto-dismiss)
- R4. Input defers sync to blur/Enter — no per-keystroke snapping
- R5. Custom slider: draggable ball on plain horizontal line, no filled-track tube
- R6. Snap markers at 10%, 25%, 50%, 75%, 100% of wallet balance with percentage labels
- R7. Clicking a snap marker sets amount to that % of balance (rounded, min 1)
- R8. Percentage snap markers replace the existing fixed-amount preset buttons
- R9. Slider max and snap points use actual wallet balance (not hardcoded 500), sourced from `/api/balance` SWR key
- R10. While balance is loading, slider and input are disabled
- R11. Works on both mobile and desktop

## Scope Boundaries

- No changes to trade submission logic, LMSR math, staleness detection, or Buy button
- No changes to the YES/NO outcome selector
- No changes to BetSheet structure
- `SellButton` and sell flow are out of scope

### Deferred to Separate Tasks

- Balance awareness for `FeedCard` and `MarketHUD` call sites of `TradePanel` — they will benefit automatically from Unit 2's internal SWR fetch, but are not specifically tested or targeted here

## Context & Research

### Relevant Code and Patterns

- `src/components/CoinSlider.tsx` — current slider (native range input, to be redesigned in-place)
- `src/components/TradePanel.tsx` — host of amount state, `handleAmountChange`, preset buttons (to be removed), and `CoinSlider` usage
- `src/components/BetSheet.tsx` — sheet wrapper; no changes needed once TradePanel self-fetches balance
- `src/components/BalanceChip.tsx` — defines `balanceFetcher` + SWR usage on `/api/balance`; fetcher must be extracted
- `src/lib/market-fetcher.ts` — pattern for shared SWR fetcher modules (extract balance-fetcher to mirror this)
- `src/app/api/balance/route.ts` — balance API route; missing three-layer SWR cache fix
- `src/app/globals.css` lines 54–87 — `input[type="range"]` pseudo-element CSS that becomes dead code after redesign; must be removed

### SWR Patterns

- Module-level fetcher functions (never inline lambdas) keep SWR cache keys stable — see `market-fetcher.ts`
- SWR deduplicates by key: adding `/api/balance` in TradePanel adds zero extra network requests when BalanceChip is mounted simultaneously
- Post-mutation cache invalidation uses `useSWRConfig().mutate("/api/balance")` — this existing pattern is preserved
- The `balance` route is currently missing the three-layer cache fix documented in `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`; without it, balance data may be stale

### Custom Slider Drag Pattern

No drag library exists. All pointer interaction must use the web platform's pointer-capture API:

```
onPointerDown → e.currentTarget.setPointerCapture(e.pointerId)
onPointerMove → compute value from getBoundingClientRect() + e.clientX
onPointerUp   → release (browser auto-releases on capture element)
```

`setPointerCapture` handles mouse, touch, and stylus uniformly and eliminates the `document.addEventListener` teardown footgun.

### Design Tokens (Tailwind v4 — tokens in globals.css, no config file)

| Token | Purpose |
|-------|---------|
| `bg-accent` | Slider ball, active snap marker |
| `bg-border` | Track line color |
| `text-muted` | Inactive snap marker labels |
| `text-foreground` | Active snap marker labels |
| `bg-red / text-red` | "Not enough coins" flash error |

### Institutional Learnings

- Three-layer cache fix is mandatory for live data routes — apply to `/api/balance/route.ts` (see `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`)
- Touch targets must be ≥ 44px; use padding/hit-zone expansion around a smaller visual element rather than making the visual element large

## Key Technical Decisions

- **TradePanel fetches balance internally** — `useSWR('/api/balance', balanceFetcher)` lives inside TradePanel, not BetSheet. All three call sites (BetSheet, FeedCard, MarketHUD) benefit automatically. SWR deduplication ensures zero extra requests. The `userBalance` prop remains as an optional override.
- **CoinSlider redesigned in-place** — same file and import path, new implementation. No rename needed.
- **Amount state stays in TradePanel** — `amount` is the single source of truth; both the text input and the slider are controlled from it. A separate `localInput` string tracks mid-entry typed text to support R4's defer-to-blur behavior.
- **Snap markers are part of CoinSlider** — `max` (the balance) is passed in; CoinSlider renders markers at `[0.10, 0.25, 0.50, 0.75, 1.00] * max`.

## Open Questions

### Resolved During Planning

- **Where does balance come from?** TradePanel fetches it internally via SWR. BetSheet needs no changes.
- **Custom slider library?** No headless UI or Radix installed — pure pointer-event implementation.
- **Keep fixed preset buttons or replace?** Replace entirely with % snap markers (R8). Fixed coin amounts don't scale with balance.

### Deferred to Implementation

- **Exact track/ball pixel sizing**: Choose visual dimensions during implementation to match Axiom-style aesthetics within the existing card width.
- **`userBalance` prop deprecation**: The prop currently exists on `TradePanelProps`. After TradePanel self-fetches, it becomes a rarely-used override. Decide during implementation whether to keep it, mark it deprecated, or remove it.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Amount state flow across the two inputs:**

```
TradePanel state:
  amount: number          ← single source of truth (1..balance)
  localInput: string      ← mid-entry text (e.g. "1" before user types "10")
  isEditing: boolean      ← true while text input has focus

Text input
  value = isEditing ? localInput : String(amount)
  onChange → setLocalInput(raw); setIsEditing(true)
  onBlur / onKeyDown(Enter):
    parsed = parseInt(localInput) || 1
    clamped = clamp(parsed, 1, balance)
    if (clamped < parsed) flash "Not enough coins" for 1.5s
    setAmount(clamped)
    setLocalInput(String(clamped))
    setIsEditing(false)

CoinSlider (custom drag)
  value = amount
  onChange(v) → setAmount(v); setLocalInput(String(v)); setIsEditing(false)

Snap marker click(pct)
  → setAmount(max(1, round(balance * pct)))
  → setLocalInput(...)
  → setIsEditing(false)
```

**Custom drag computation in CoinSlider:**

```
onPointerMove:
  rect = trackRef.current.getBoundingClientRect()
  ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
  value = clamp(round(ratio * max), min, max)
  onChange(value)
```

## Implementation Units

- [ ] **Unit 1: Extract balance fetcher and apply cache fix**

**Goal:** Move `balanceFetcher` out of `BalanceChip` into a shared module so TradePanel can reuse it without duplicating the function. Apply the three-layer cache fix to `/api/balance/route.ts` so balance data is always fresh.

**Requirements:** R9 (prerequisite), R10 (prerequisite)

**Dependencies:** None

**Files:**
- Create: `src/lib/balance-fetcher.ts`
- Modify: `src/components/BalanceChip.tsx` (import from shared module)
- Modify: `src/app/api/balance/route.ts` (three-layer cache fix)

**Test expectation:** none — no component test infrastructure exists in this codebase; test scenarios are manual verification checklists

**Approach:**
- Extract `balanceFetcher` from `BalanceChip.tsx` verbatim into `src/lib/balance-fetcher.ts` and move the `BalanceData` interface there too (it is currently private at line 8 of `BalanceChip.tsx` — export it from the new module and delete it from `BalanceChip.tsx` to avoid duplicate definitions). Mirror the structure of `src/lib/market-fetcher.ts`.
- In `BalanceChip.tsx`, replace the local `balanceFetcher` and `BalanceData` with imports from the new module. Behavior must be identical.
- In `/api/balance/route.ts`, add `export const dynamic = "force-dynamic"` and `Cache-Control: no-store` to the response. Add `{ cache: "no-store" }` to the `fetch()` call if one exists (route uses Drizzle directly, so no fetch to patch — only the response header and dynamic export are needed).

**Patterns to follow:**
- `src/lib/market-fetcher.ts` — shape of shared fetcher module
- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — three-layer fix checklist

**Test scenarios:**
- Happy path: `balanceFetcher('/api/balance')` resolves to `{ balance, loginStreak, lastLoginReward }`
- Error path: route returns non-OK status → fetcher throws (same behavior as before extraction)
- Integration: `BalanceChip` still renders the correct balance after the import is switched to the shared module

**Verification:**
- `BalanceChip` renders the same balance as before
- The shared `balanceFetcher` is importable from `src/lib/balance-fetcher.ts`
- `/api/balance` response includes `Cache-Control: no-store`

---

- [ ] **Unit 2: Wire live balance into TradePanel**

**Goal:** Replace the hardcoded-500 fallback with the user's actual wallet balance inside TradePanel. Expose `balance` and `isBalanceLoading` as internal derived values for the slider and input.

**Requirements:** R9, R10

**Dependencies:** Unit 1

**Files:**
- Modify: `src/components/TradePanel.tsx`

**Test expectation:** none — no component test infrastructure exists in this codebase; test scenarios are manual verification checklists

**Approach:**
- Add `useSWR<BalanceData>('/api/balance', balanceFetcher, { fallbackData: ... })` inside TradePanel. Import `balanceFetcher` from `src/lib/balance-fetcher.ts`.
- Derive `balance = balanceData?.balance ?? (userBalance ?? 500)` — the `userBalance` prop remains as an override (for tests or edge cases) but is no longer the primary source.
- Derive `isBalanceLoading = !balanceData && !balanceError` (standard SWR loading detection) — pass to CoinSlider and the text input as `disabled`.
- Replace the existing `const sliderMax = userBalance ?? 500` line with `const sliderMax = balance`.
- No changes to `handleAmountChange`, trade logic, staleness detection, or Buy button.

**Patterns to follow:**
- Existing `useSWR` call in `BetSheet.tsx` for market data (parallel SWR calls in the same component)
- `useSWRConfig().mutate` is already called in other components after trades — no change needed here

**Test scenarios:**
- Happy path: balance resolves to 300 → `sliderMax` becomes 300
- Edge case: balance resolves to 0 → `sliderMax` = 0; slider and input should be disabled (min=1 prevents a trade anyway)
- Loading state: `isBalanceLoading` is true before SWR resolves → slider + input render as disabled
- Fallback: `userBalance` prop provided and balance SWR fails → falls back to `userBalance`

**Verification:**
- `sliderMax` matches the SWR-resolved balance
- Slider and input are disabled while balance is loading

---

- [ ] **Unit 3: Redesign CoinSlider with custom drag and snap markers**

**Goal:** Replace the native `<input type="range">` with a custom pointer-event drag slider. Add visible snap markers at 10/25/50/75/100% of `max` with percentage labels. Remove the dead CSS from `globals.css`.

**Requirements:** R5, R6, R7, R11

**Dependencies:** Unit 2 (for `max` to reflect real balance, though the component itself can be developed independently)

**Files:**
- Modify: `src/components/CoinSlider.tsx`
- Modify: `src/app/globals.css` (remove `input[type="range"]` block, lines ~54–87)

**Test expectation:** none — no component test infrastructure exists in this codebase; test scenarios are manual verification checklists

**Approach:**
- Replace `<input type="range">` with a `<div>` track containing a draggable ball `<div>`.
- Track renders as a horizontal line (`bg-border`, thin height ~2px). Ball renders as a circle (`bg-accent`, ~16px diameter).
- Ball position: `left: (value / max) * 100%` via inline style on an absolutely-positioned element inside a `position: relative` track container.
- Pointer events on the track div:
  - `onPointerDown`: call `e.currentTarget.setPointerCapture(e.pointerId)`, begin drag
  - `onPointerMove`: compute `ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)`, call `onChange(clamp(Math.round(ratio * max), min, max))`
  - `onPointerUp`: end drag (browser releases capture automatically)
- Snap markers: render 5 markers at `[0.10, 0.25, 0.50, 0.75, 1.00]` positions. Each is an `<button>` or clickable `<div>` with a small dot and a `%` label below. Clicking calls `onChange(Math.max(min, Math.round(pct * max)))`.
- Touch target: ball has a larger invisible hit zone (e.g., 44×44px padding area) around the ~16px visual circle using `padding` + `box-sizing: content-box` or a pseudo-element equivalent.
- Disabled state: `pointer-events: none` + `opacity-50` on the whole container.
- Remove the large coin count display (lines 20–23 of current CoinSlider) — it will be replaced by the text input in Unit 4.
- Remove `input[type="range"]` CSS block from `globals.css`.

**Patterns to follow:**
- Existing touch-target sizing: `style={{ height: "44px" }}` pattern from current CoinSlider
- Token usage: `bg-accent`, `bg-border`, `text-muted`, `text-foreground` from globals.css

**Test scenarios:**
- Happy path: dragging ball from left to right calls `onChange` with values increasing from `min` to `max`
- Edge case: drag beyond left edge → value clamps to `min`; drag beyond right edge → value clamps to `max`
- Edge case: `max = 1` → all snap markers resolve to 1; all clicks call `onChange(1)`
- Happy path: clicking "25%" marker with `max = 200` calls `onChange(50)`
- Happy path: clicking "10%" marker with `max = 7` calls `onChange(1)` (Math.round(0.7) = 1, max(1, 1) = 1)
- Happy path: disabled=true → no pointer events fire, component renders at 50% opacity
- Integration: slider works on mobile touch (pointer events cover touch via setPointerCapture)

**Verification:**
- Ball position visually matches `value / max` fraction along the track
- Snap markers render at correct horizontal positions
- Dragging on mobile does not scroll the page (pointer capture prevents it)
- No `input[type="range"]` CSS remains in `globals.css`

---

- [ ] **Unit 4: Add bidirectional text input and remove fixed presets**

**Goal:** Add an editable coin amount text input to TradePanel. Wire it bidirectionally with the redesigned CoinSlider. Remove the fixed-amount preset buttons [10, 25, 50, 100]. Implement clamp + flash error for over-balance entries.

**Requirements:** R1, R2, R3, R4, R8

**Dependencies:** Unit 3

**Files:**
- Modify: `src/components/TradePanel.tsx`

**Test expectation:** none — no component test infrastructure exists in this codebase; test scenarios are manual verification checklists

**Approach:**
- Add state: `localInput: string` (raw typed value mid-entry) and `isEditing: boolean`.
- Add state: `balanceError: string` (the flash error message, auto-clears after 1.5s via `setTimeout` + `clearTimeout` on cleanup).
- Text input (`<input type="text" inputMode="numeric" pattern="[0-9]*">`):
  - Controlled: `value = isEditing ? localInput : String(amount)`
  - `onChange`: `setLocalInput(e.target.value); setIsEditing(true)`
  - `onBlur` and `onKeyDown` (Enter): call `commitInput()`
- `commitInput()`:
  1. `parsed = parseInt(localInput, 10) || 1`
  2. `clamped = Math.min(Math.max(parsed, 1), sliderMax)`
  3. If `clamped < parsed`: set `balanceError("Not enough coins")`, schedule clear after 1.5s
  4. `setAmount(clamped); setLocalInput(String(clamped)); setIsEditing(false)`
- CoinSlider `onChange` handler: call `handleAmountChange(v)` (existing), also `setLocalInput(String(v)); setIsEditing(false)`.
- Remove the fixed preset buttons block (lines 184–195 in current TradePanel).
- Layout: text input sits above or inline with the CoinSlider, styled to match the card's existing design language (same font size and weight as the current coin count display it replaces).
- The flash error (`balanceError`) renders inline near the input, distinct from the existing trade error state (`error`) which persists until next action.

**Patterns to follow:**
- `src/components/SellButton.tsx` lines 66–72 — the existing integer input + `parseInt` + clamp pattern in the codebase
- Existing `error` display block in TradePanel (lines ~249–254) for error styling reference
- `setTimeout` + ref cleanup pattern used in `BetSheet.tsx` (`successTimerRef`)

**Test scenarios:**
- Happy path: type "137" → blur → slider ball moves to 137/balance position; input shows "137"
- Happy path: drag slider to 50% of 400 balance → input updates to "200"
- Happy path: click "25%" snap marker (balance=300) → input shows "75", slider ball at 25%
- Edge case: type "999" with balance=200 → on blur: input clamps to "200", "Not enough coins" flash appears, auto-dismisses after 1.5s
- Edge case: type "0" → on blur: clamps to 1 (min)
- Edge case: type "-5" → parseInt returns NaN → falls back to 1
- Edge case: clear input entirely → blur: falls back to 1
- Edge case: type "1" then "0" to form "10" → no sync fires during typing; only on blur/Enter
- Integration: flash error coexists with trade error state — both can appear simultaneously without overwriting each other
- Happy path: fixed preset buttons [10, 25, 50, 100] are no longer rendered

**Verification:**
- Typing an amount updates the slider position on blur/Enter
- Dragging the slider updates the text input immediately
- Over-balance entry clamps and flashes a brief error
- No fixed preset buttons visible in the UI

## System-Wide Impact

- **Interaction graph:** `BalanceChip` and `TradePanel` now share the `/api/balance` SWR key. A trade or sell that calls `globalMutate("/api/balance")` will refresh both simultaneously — this is the existing intended pattern and no change is needed.
- **Error propagation:** If the `/api/balance` SWR fetch fails, `balanceData` is undefined and `balance` falls back to `userBalance ?? 500`. Once `balanceError` is set by SWR, `isBalanceLoading` becomes false (since `!balanceData && !balanceError` → false) so the slider re-enables and operates on 500 coins — not the user's real balance. A user could theoretically attempt a trade that exceeds their true balance (the server will reject it). This is an accepted risk that preserves pre-polish behavior; the implementing agent should add an inline comment at the fallback derivation to document the intent explicitly.
- **State lifecycle risks:** The `localInput` / `isEditing` state pair must reset when `amount` is set externally (e.g. via slider drag or snap click) — the approach in Unit 4 handles this by always resetting `isEditing` on non-keyboard-driven updates.
- **Unchanged invariants:** Trade submission path (`buyShares`, `checkStaleness`, `executeBuy`, Buy button), LMSR math, staleness detection, YES/NO selector, SellButton — all untouched.
- **FeedCard + MarketHUD:** Both render TradePanel but do not pass `userBalance`. They will automatically gain balance-awareness from Unit 2's internal SWR fetch. No code changes required in those files, but they should be verified to still render correctly.
- **API surface parity:** The `userBalance` prop on `TradePanelProps` remains valid — it now acts as an override if provided, rather than the primary source.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `/api/balance` was missing three-layer cache fix — stale balance data | Unit 1 applies the fix before balance is relied upon for snap points |
| Pointer-capture drag is the first drag interaction in this codebase | Well-tested web platform API; `setPointerCapture` is universal across mouse/touch/stylus |
| Mobile page scroll interfering with horizontal drag | `setPointerCapture` on `onPointerDown` prevents scroll hijack |
| `localInput` / `isEditing` state diverging from `amount` if resets are missed | Unit 4 approach always syncs `localInput` on any non-keyboard update |
| FeedCard and MarketHUD now implicitly fetch balance | SWR deduplication means zero extra requests; both components benefit silently |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-18-place-trade-slider-polish-requirements.md](docs/brainstorms/2026-04-18-place-trade-slider-polish-requirements.md)
- Related code: `src/components/CoinSlider.tsx`, `src/components/TradePanel.tsx`, `src/components/BetSheet.tsx`, `src/components/BalanceChip.tsx`
- Related code: `src/lib/market-fetcher.ts` (shared fetcher pattern to mirror)
- Related code: `src/app/api/balance/route.ts` (cache fix target)
- Institutional learning: `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`
