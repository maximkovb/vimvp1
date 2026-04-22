# Review Run: 20260418-162210-0e28fdcb

**Branch:** feat/trade-slider-polish  
**Base:** e75383ca735b8584b81e19e1f54f66eefeb6a2ff  
**Files reviewed:** 6  
**Reviewers:** correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, security, performance, reliability, julik-frontend-races, kieran-typescript  

## Applied Fixes (safe_auto)

| # | File | Fix |
|---|------|-----|
| 1 | `src/lib/balance-fetcher.ts:13` | Added `{ cache: "no-store" }` to fetch — completes the 3-layer cache fix |
| 2 | `src/components/CoinSlider.tsx:58` | Fixed `ballPct` NaN guard: `max > 0` → `max > min` |
| 3 | `src/components/CoinSlider.tsx:69` | Added `onPointerCancel={handlePointerUp}` — resets isDragging on mobile scroll cancellation |
| 4 | `src/components/TradePanel.tsx:83` | Fixed negative-input flash: `clamped < valid` → `clamped !== valid` |
| 5 | `src/components/TradePanel.tsx:83` | Added `effectiveMax = isNaN(sliderMax) ? 1 : sliderMax` guard in commitInput |
| 6 | `src/components/TradePanel.tsx` | Added `isChecking` state — disables Buy button during checkStaleness async call |
| 7 | `src/components/TradePanel.tsx` | Added `AbortSignal.timeout(8_000)` to checkStaleness fetch |
| 8 | `src/components/TradePanel.tsx` | Wrapped `buyShares` await in try/catch — surfaces thrown errors as inline error state |

## Residual Findings (gated_auto / manual / advisory)

### P1
- **security**: `buyShares` accepts float `amount` and has no server-side ceiling — add `Number.isInteger` + `MAX_TRADE_COINS` guard in `src/lib/actions/trade.ts`
- **reliability**: 401 on /api/balance silently falls back to 500-coin balance — consider surfacing auth failure state

### P2
- **correctness**: Post-trade reset to `amount=10` can briefly exceed post-trade `sliderMax` before SWR revalidates
- **correctness/maintainability**: `valueFromPointer` uses `ratio * max` not `ratio * (max - min) + min` — minor interpolation drift when min > 0
- **performance**: TradePanel `useSWR` missing `{ revalidateOnFocus: false }` — each tab focus re-renders all mounted TradePanels
- **maintainability**: `userBalance` prop is never passed by any caller — remove it
- **maintainability**: `executeBuy` duplicates the 5-setter reset sequence — extract `resetToDefault()` helper
- **project-standards**: Amber colors in staleness warning block (`bg-amber-500`, `text-amber-600`, `dark:text-amber-400`) not in `@theme inline` tokens — use CSS variables or add tokens
- **project-standards**: `bg-black/90` in tooltip divs not tokenized
- **typescript**: `res.json()` in `balanceFetcher` is an unchecked cast — add runtime type guard
- **typescript**: `checkStaleness` accesses `fresh.*` fields on implicit `any`
- **frontend-races**: CSS `pointer-events-none` does not stop already-captured pointer events when `disabled` transitions mid-drag

### P2 (pre-existing)
- **agent-native**: `buyShares`, `sellShares`, `previewTrade`, and `GET /api/balance` not documented in `AGENTS.md`

### P3
- **testing**: No component tests exist; `vitest.config.ts` uses `environment: 'node'` — jsdom + @testing-library needed to run any UI tests
- **maintainability**: `1500` flash duration is a bare magic literal — extract `BALANCE_ERROR_FLASH_MS`
- **typescript**: `trackRef.current!` non-null assertion in `valueFromPointer`
