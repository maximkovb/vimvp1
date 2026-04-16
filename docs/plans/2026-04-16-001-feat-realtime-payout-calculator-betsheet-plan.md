---
title: "feat: Real-Time Payout Calculator in BetSheet"
type: feat
status: active
date: 2026-04-16
---

# feat: Real-Time Payout Calculator in BetSheet

## Overview

Upgrade `TradePanel` (rendered inside `BetSheet`) with a large drag slider for coin amount. As the user drags, three values update in real time with zero API calls: coins wagered, payout-if-YES, and payout-if-NO. A secondary line shows price impact. LMSR math runs client-side using the existing `src/lib/lmsr.ts`. On submission, re-fetch the current price server-side and show a staleness warning if the price moved >2%.

---

## Problem Statement

The current `TradePanel` uses a plain `<input type="number">` with preset buttons (10/25/50/100 coins). Every amount change fires a debounced server action (`previewTrade`) 400ms later, adding latency and network overhead. The payout display shows only "shares" — not the coin value of winning, and not separate YES/NO payouts. There is no price-staleness guard at submit time.

---

## Research Findings

### What already exists

| Asset | Location | Notes |
|---|---|---|
| LMSR math | `src/lib/lmsr.ts` | `sharesForCost`, `tradeCost`, `allPrices`, `price` — pure math, no DB deps |
| BetSheet | `src/components/BetSheet.tsx` (147 lines) | Vaul drawer; SWR-fetches full market data when open |
| TradePanel | `src/components/TradePanel.tsx` (201 lines) | Receives `prices[]` only — no access to `quantities` or `bParameter` |
| previewTrade | `src/lib/actions/trade.ts:42` | Server action: returns `{ shares, cost, avgPrice, priceImpact, currentPrice, newPrice }` |
| buyShares | `src/lib/actions/trade.ts:88` | Optimistic-lock, 3-retry transaction |
| Market SWR data | `BetSheet.tsx` lines 45–47 | `marketData` from SWR includes `priceYes`, `priceNo` but **not** `quantityYes`, `quantityNo`, `bParameter` |

### Key gap: quantities not passed to TradePanel

`BetSheet` only passes `livePrices = [priceYes, priceNo]` to `TradePanel`. Client-side LMSR requires `quantities = [quantityYes, quantityNo]` and `bParameter`. These fields must be added to the `/api/markets/[id]` response (or `MarketData` type) and threaded through to `TradePanel`.

### Known regression: BetSheet SWR fetcher missing `cache: "no-store"`

`src/components/BetSheet.tsx` does not use the shared `marketFetcher` from `src/lib/market-fetcher.ts`. The fetcher is missing the `{ cache: "no-store" }` Layer 3 cache fix (tracked in `todos/112-complete-p2-betsheet-swr-fetcher-not-shared.md`). This must be resolved as a prerequisite — stale quantities would produce wrong client-side LMSR results.

### No existing slider component

Only slider in codebase is the admin milestone input (`src/app/admin/markets/new/page.tsx:391`). A reusable `CoinSlider` component must be built for the user-facing betting flow.

### Payout semantics

In LMSR with this market design: winning shares pay out 1 coin each at resolution.
- **Payout if YES wins** = `sharesForCost([qYes, qNo], b, 0, amount)` coins
- **Payout if NO wins** = `sharesForCost([qYes, qNo], b, 1, amount)` coins
- **Price impact (YES trade)** = `allPrices([qYes + sharesYes, qNo], b)[0] - priceYes`
- **Price impact (NO trade)** = `allPrices([qYes, qNo + sharesNo], b)[1] - priceNo`

---

## Proposed Solution

### Phase 1 — Thread quantities through; replace server preview with client-side LMSR

1. Expose `quantityYes`, `quantityNo`, `bParameter` in `GET /api/markets/[id]` response and `MarketData` type.
2. Fix BetSheet SWR fetcher to use shared `marketFetcher` (resolves todo `112`).
3. Pass `quantities` and `bParameter` as new props to `TradePanel`.
4. Replace the 400ms debounced `previewTrade` server action call with synchronous client-side LMSR:
   ```ts
   // Client-side — zero API calls
   const sharesYes = sharesForCost(quantities, b, 0, amount);
   const sharesNo  = sharesForCost(quantities, b, 1, amount);
   const newQYes   = [quantities[0] + sharesYes, quantities[1]];
   const impactYes = allPrices(newQYes, b)[0] - priceYes;
   ```

### Phase 2 — Add drag slider and real-time payout display

5. Build `src/components/CoinSlider.tsx` — a styled `<input type="range">` with:
   - Min: 1, Max: user coin balance (or 500 as safe cap), Step: 1
   - Large touch target, Tailwind-styled thumb and track
   - Displays current value as large centered coin amount above the track
6. Replace `<input type="number">` in `TradePanel` with `CoinSlider`. Keep preset buttons (10/25/50/100) as quick-jump anchors that set the slider position.
7. Render a **real-time payout panel** (replaces current preview block):
   ```
   ┌──────────────────────────────────────┐
   │  150 coins                           │
   │  ─────────────────────────────────── │
   │  Payout if YES  →  243.7 coins  ✓   │
   │  Payout if NO   →  112.4 coins       │
   │  Price impact   →  +2.1%            │
   └──────────────────────────────────────┘
   ```
   Selected outcome row gets a checkmark/highlight. Updates synchronously on every slider `onChange`.

### Phase 3 — Staleness guard on submit

8. On "Buy" button click:
   a. Re-fetch `/api/markets/[id]` (single fresh fetch, not SWR).
   b. Compute `priceDelta = abs(freshPrices[outcome] - cachedPrices[outcome])` — use the selected outcome's price, not hardcoded YES.
   c. If `priceDelta > 0.02` (2%), show inline confirm:
      ```
      ⚠ Price moved +1.8%. New payout: 231.2 coins. Confirm?  [Cancel] [Buy anyway]
      ```
   d. If user confirms (or delta ≤ 2%), proceed with `buyShares` as before.
   e. `buyShares` already uses optimistic locking — no changes needed to the server action.

---

## Technical Considerations

### Client-side LMSR performance

`sharesForCost` uses binary search (~20 iterations max). At 60fps slider drag, this is imperceptible. No throttling needed; run on every `onChange`.

### Props changes to TradePanel

```ts
// Before
interface TradePanelProps {
  marketId: string;
  prices: number[];         // [priceYes, priceNo]
  initialOutcome?: number;
  onTradeSuccess?: (result: TradeResult) => void;
}

// After
interface TradePanelProps {
  marketId: string;
  prices: number[];         // [priceYes, priceNo] — still used for outcome buttons
  quantities: number[];     // [quantityYes, quantityNo] — NEW
  bParameter: number;       // LMSR b — NEW
  userBalance?: number;     // for slider max — NEW (optional, fallback to 500)
  initialOutcome?: number;
  onTradeSuccess?: (result: TradeResult) => void;
}
```

`BetSheet` already has `marketData` from SWR — destructure `quantityYes`, `quantityNo`, `bParameter` and pass them down. Add fallback values during SWR loading (use SSR-seeded `prices` for optimistic display; disable slider until `marketData` resolves).

### API / MarketData type changes

`src/app/api/markets/[id]/route.ts` — add to response object:
```ts
quantityYes: parseFloat(market.quantityYes),
quantityNo:  parseFloat(market.quantityNo),
bParameter:  parseFloat(market.bParameter),
```

`src/types/market.ts` — add to `MarketData`:
```ts
quantityYes: number;
quantityNo:  number;
bParameter:  number;
```

### Remove previewTrade call from TradePanel

The server action `previewTrade` (`src/lib/actions/trade.ts:42`) becomes unused in TradePanel after this change. **Do not delete it** — it may be used elsewhere or by future features. Removing the import from `TradePanel.tsx` is safe.

### Staleness threshold

2% is the documented threshold from the wiki feature spec. Hardcode as a named constant:
```ts
const PRICE_STALENESS_THRESHOLD = 0.02;
```

---

## System-Wide Impact

### Interaction graph

Slider drag → client `onChange` → `sharesForCost` + `allPrices` (sync, no I/O) → `setPayoutYes / setPayoutNo / setPriceImpact` → re-render payout panel.

Buy click → fresh `fetch('/api/markets/[id]')` → staleness check → (if ok) `buyShares` server action → optimistic-lock DB transaction → `onTradeSuccess` callback → BetSheet auto-dismiss (1.5s).

### State lifecycle risks

- Slider state is local to `TradePanel` — no risk of orphaned state.
- Fresh fetch on submit is a read — no write risk.
- `buyShares` already retries 3× on `ConcurrentTradeError` — no change.
- If fresh fetch fails, surface error and block submit (do not silently proceed with stale price).

### API surface parity

`MarketHUD` renders `TradePanel` inline (`src/components/MarketHUD.tsx:72`). After this change, `MarketHUD` must also pass `quantities` and `bParameter` to `TradePanel`. It already fetches market data — add the new fields to its destructure.

### Integration test scenarios

1. Drag slider from 0 → 200 coins: payout-if-YES and payout-if-NO update on every tick without API calls.
2. Simultaneous trade: another user buys YES while the slider is at 100 — on submit, fresh fetch detects >2% price move, staleness warning appears.
3. Price unchanged on submit (delta ≤ 2%): no warning, buy proceeds immediately.
4. Fresh fetch fails on submit: error shown, buy blocked.
5. `MarketHUD` inline panel: slider renders correctly with same real-time behavior.

---

## Acceptance Criteria

### Functional

- [ ] `TradePanel` renders a drag slider (min 1, max ≥ 100, step 1) instead of `<input type="number">`
- [ ] Payout-if-YES and payout-if-NO update synchronously on every slider drag event
- [ ] Price impact updates synchronously on every drag event
- [ ] Zero API calls are made during slider drag
- [ ] Preset buttons (10, 25, 50, 100) still work and snap the slider to those values
- [ ] On submit: fresh price is fetched before `buyShares` fires
- [ ] Staleness warning shown when price delta > 2%; user must confirm or cancel
- [ ] Buy proceeds normally when price delta ≤ 2%
- [ ] `MarketHUD` inline `TradePanel` receives `quantities` and `bParameter` and behaves identically

### Non-Functional

- [ ] Slider drag produces no perceptible lag (LMSR math < 1ms per call)
- [ ] BetSheet SWR fetcher uses `marketFetcher` with `{ cache: "no-store" }` (todo `112` resolved)
- [ ] `CoinSlider` has a touch target of ≥ 44px height (mobile-first)
- [ ] No TypeScript errors in modified files

### Quality Gates

- [ ] Existing Vitest suite (`src/lib/__tests__/lmsr.test.ts`) passes unchanged
- [ ] `PRICE_STALENESS_THRESHOLD` constant is defined and used (not a magic number)
- [ ] `previewTrade` import removed from `TradePanel.tsx` (dead import cleanup)

---

## Implementation Order

```
1. src/app/api/markets/[id]/route.ts       — add quantityYes, quantityNo, bParameter to response
2. src/types/market.ts                     — add fields to MarketData
3. src/lib/market-fetcher.ts               — verify cache: "no-store" present (todo 112 fix)
4. src/components/BetSheet.tsx             — use shared marketFetcher; pass quantities + bParameter to TradePanel
5. src/components/CoinSlider.tsx           — new component: styled range input
6. src/components/TradePanel.tsx           — accept new props; replace server preview with client LMSR; add CoinSlider; add staleness guard
7. src/components/MarketHUD.tsx            — pass quantities + bParameter to TradePanel
```

---

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `quantityYes`/`quantityNo` are `decimal` strings from Drizzle — need `parseFloat` | Certain | Apply parseFloat in API route and when reading from `marketData` |
| Slider max = user balance requires fetching balance | Low | Cap at 500 coins initially; pass `userBalance` prop optionally |
| `sharesForCost` binary search edge cases (amount=0, very large b) | Low | Existing Vitest suite covers edge cases; guard `amount > 0` before calling |
| Stale quantities during SWR loading (before first fetch resolves) | Possible | Disable slider and show loading state until `marketData` resolves |
| `MarketHUD` missing the new props breaks TypeScript build | Certain | Fix in same PR (step 7 above) |

---

## Sources & References

### Internal

- BetSheet component: `src/components/BetSheet.tsx`
- TradePanel component: `src/components/TradePanel.tsx`
- LMSR library: `src/lib/lmsr.ts`
- Trade server actions: `src/lib/actions/trade.ts:42` (previewTrade), `src/lib/actions/trade.ts:88` (buyShares)
- Market API route: `src/app/api/markets/[id]/route.ts`
- MarketData type: `src/types/market.ts`
- Relevant todo: `todos/112-complete-p2-betsheet-swr-fetcher-not-shared.md`

### Learnings (docs/solutions)

- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — all three cache layers must be fixed simultaneously; BetSheet fetcher has known Layer 3 gap
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — optimistic locking and `referenceId` idempotency on coin ledger entries

### Wiki

- Feature spec: `projects/virality/pages/features/getspike-parity-features.md` — Feature #2
- Related: `projects/virality/pages/concepts/prediction-markets.md`
