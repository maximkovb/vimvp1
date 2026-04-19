---
title: "Client-Side LMSR Payout Calculator in BetSheet"
category: ui-bugs
date: 2026-04-16
tags:
  - lmsr
  - payout-calculator
  - client-side-math
  - real-time-ui
  - bet-sheet
  - trade-panel
  - price-impact
  - staleness-guard
  - swr
  - coin-slider
  - server-action-removal
  - prediction-market
modules:
  - src/components/TradePanel.tsx
  - src/components/BetSheet.tsx
  - src/components/CoinSlider.tsx
  - src/components/FeedCard.tsx
  - src/components/MarketHUD.tsx
  - src/components/DiscoverFeed.tsx
  - src/app/api/markets/[id]/route.ts
  - src/app/markets/[id]/page.tsx
  - src/lib/lmsr.ts
  - src/types/market.ts
problem_type: ui-responsiveness — server round-trip for pure math; replaced with synchronous client-side computation + submit-time staleness guard
---

# Client-Side LMSR Payout Calculator in BetSheet

## Problem Statement

`TradePanel` showed payout estimates by calling `previewTrade` (a `"use server"` action) on every amount input change, debounced to 400ms. This made the UI feel sluggish — users could not see real-time payout-if-YES, payout-if-NO, or price impact until after a server round-trip. Additionally, the payout display showed only "shares" rather than coin value split by outcome, and there was no protection against placing a trade at a stale price after the market had moved.

## Root Cause

The LMSR math (`sharesForCost`, `allPrices`) is pure arithmetic with no I/O dependencies. It was running on the server only because `TradePanel` was wired to call `previewTrade`, not because it needed to. The client already had everything required — once `quantityYes`, `quantityNo`, and `bParameter` were exposed by the API, the entire preview could move to the browser.

## Investigation Findings

### What already existed (no extraction needed)

`src/lib/lmsr.ts` was already a pure-math module with no server-only imports — fully client-importable. The wiki had suggested "extracting LMSR to a shared lib," but it was already there. Key exports: `sharesForCost`, `allPrices`, `tradeCost`, `price`.

`BetSheet` already used `marketFetcher` with `{ cache: 'no-store' }` and all three Next.js cache layers were in place from prior work (see `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`). The BetSheet fetcher regression (todo 112) was already resolved.

`buyShares` returns `{ success: true; shares: number; cost: number }` — there is **no `priceAfter`** field. Post-trade prices must be computed client-side.

### What was missing

- `GET /api/markets/[id]` did not return `quantityYes`, `quantityNo`, or `bParameter` — only the derived `priceYes`/`priceNo`.
- `MarketData` type did not include those fields.
- `TradePanel` had no slider and no client-side payout logic.
- TypeScript surfaced **four additional prop-threading call sites** beyond what the plan anticipated: `BetSheet`, `FeedCard` (desktop inline TradePanel), `MarketHUD`, and `src/app/markets/[id]/page.tsx` (SSR `initialData`).

## The Working Solution

### 1. Expose raw LMSR state in the API + type

```ts
// src/app/api/markets/[id]/route.ts — add to payload
quantityYes: quantities[0],   // already computed above
quantityNo:  quantities[1],
bParameter:  b,
```

```ts
// src/types/market.ts
quantityYes: number;
quantityNo:  number;
bParameter:  number;
```

### 2. CoinSlider component

`src/components/CoinSlider.tsx` — `<input type="range">` with 44px touch target and large coin display:

```tsx
export function CoinSlider({ value, onChange, min = 1, max = 500, disabled = false }) {
  return (
    <div className="space-y-1">
      <div className="text-center py-1">
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        <span className="text-sm text-muted ml-1.5">coins</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={1} value={value} disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{ height: "44px", cursor: disabled ? "not-allowed" : "pointer" }}
        className="w-full accent-accent disabled:opacity-50"
      />
    </div>
  );
}
```

### 3. Client-side payout math in TradePanel

Remove the `previewTrade` import. Import from `src/lib/lmsr.ts` instead:

```ts
import { sharesForCost, allPrices } from "@/lib/lmsr";

const PRICE_STALENESS_THRESHOLD = 0.02;

// Runs synchronously on every slider onChange — no debounce needed
const payoutYes = amount > 0 ? sharesForCost(quantities, bParameter, 0, amount) : 0;
const payoutNo  = amount > 0 ? sharesForCost(quantities, bParameter, 1, amount) : 0;

// Price impact for selected outcome
const selectedShares = outcome === 0 ? payoutYes : payoutNo;
const newQ = [...quantities];
newQ[outcome] += selectedShares;
const priceImpact = allPrices(newQ, bParameter)[outcome] - prices[outcome];
```

Display both payout rows; highlight the selected outcome. Show price impact below.

### 4. Staleness guard on submit

```ts
async function checkStaleness(): Promise<boolean> {
  const res = await fetch(`/api/markets/${marketId}`, { cache: "no-store" });
  const fresh = await res.json();
  const outcomeDelta = Math.abs(
    (outcome === 0 ? fresh.priceYes : fresh.priceNo) - prices[outcome]
  );
  if (outcomeDelta > PRICE_STALENESS_THRESHOLD) {
    const freshPayout = sharesForCost(
      [fresh.quantityYes, fresh.quantityNo],
      fresh.bParameter,
      outcome,
      amount
    );
    setStaleConfirm({ payoutAtFreshPrices: freshPayout });
    return false;
  }
  return true;
}
```

Use the **selected outcome's price**, not hardcoded `priceYes` — a NO bet should check `priceNo` drift.

### 5. Compute priceAfter client-side after buyShares

```ts
const result = await buyShares(marketId, outcome, amount);
// buyShares returns { success: true, shares, cost } — no priceAfter
const newQ = [...quantities];
newQ[outcome] += result.shares;
const priceAfter = allPrices(newQ, bParameter)[outcome];
onTradeSuccess?.({ outcome, cost: result.cost, shares: result.shares, priceAfter });
```

### 6. Prop threading — all call sites

| Call site | Change |
|---|---|
| `src/components/BetSheet.tsx` | Destructure `quantityYes/No/bParameter` from SWR `marketData`; pass as `quantities=[...]` + `bParameter` to `TradePanel`. Fallback `[0, 0]` / `0` while loading (slider disabled). |
| `src/components/FeedCard.tsx` | Add `quantityYes`, `quantityNo`, `bParameter` to `FeedCardProps`; pass to desktop inline `TradePanel`. |
| `src/components/DiscoverFeed.tsx` | `parseFloat(market.quantityYes/No/bParameter)` and pass to `FeedCard`. |
| `src/components/MarketHUD.tsx` | `market.quantityYes/No/bParameter` from `useMarketData`; pass to `TradePanel`. |
| `src/app/markets/[id]/page.tsx` | Include in SSR `initialData` object (already has `quantities` + `b` computed). |

---

## Key Gotchas

**FeedCard is a hidden TradePanel host.** The desktop side HUD in `FeedCard` renders its own inline `TradePanel`. The plan accounted for BetSheet and MarketHUD but not FeedCard. TypeScript caught the shape mismatch, but it required adding props to FeedCard and threading them through DiscoverFeed. Any future TradePanel prop additions need the same treatment.

**SSR initialData is a third MarketData source.** `src/app/markets/[id]/page.tsx` constructs `initialData` as a plain object in a server component — not via the API route. TypeScript caught the mismatch, but the fix must happen in the SSR path separately.

**`buyShares` has no `priceAfter`.** Recompute post-trade prices client-side using `result.shares` and local `quantities`.

**Three-layer cache is load-bearing for staleness correctness.** If `force-dynamic`, `Cache-Control: no-store`, or `fetch cache: 'no-store'` is missing from the market API route, the staleness fresh-fetch may return a cached response. All three layers were already in place; removing any one silently breaks the guard.

**`sharesForCost` takes a numeric outcome index (0/1), not a string.** Passing a string silently returns `NaN`.

**`quantityYes`/`quantityNo` are `decimal` strings from Drizzle.** Always `parseFloat()` before passing to LMSR functions.

---

## When to Use Client-Side LMSR vs Server Action Previews

Use client-side LMSR for any **read-only preview** (payout display, price impact, cost estimators). The binary search runs in ~20 iterations — imperceptible at interactive framerates.

Use a server action for the **actual transaction**. The server must recompute from its own current state. The client-side calculation is a UX aid, not authoritative.

**Rule:** if the user hasn't clicked "confirm" yet → compute on the client. The moment money moves → go to the server.

## Data Required for Client-Side LMSR

Any component importing from `src/lib/lmsr.ts` needs:

- `quantityYes` — total outstanding YES shares (not the current order size)
- `quantityNo` — total outstanding NO shares
- `bParameter` — liquidity parameter

`priceYes`/`priceNo` are **derived outputs** of LMSR, not inputs. They cannot be back-solved into quantities without `bParameter`, and even then the inversion is fragile. Always source raw quantities from the API.

**Checklist for any new LMSR component:**
- [ ] API route returns `quantityYes`, `quantityNo`, `bParameter`
- [ ] `MarketData` type declares all three as non-optional `number`
- [ ] Component passes raw quantities (not prices) into LMSR functions
- [ ] Slider/preview is disabled while SWR loading (`bParameter === 0` guard)

## Staleness Guard Pattern

Apply on every financial submit path where the user commits based on a price seen earlier:

1. Record prices when component initializes.
2. On submit, fire a fresh fetch before the server action.
3. Compare `|freshPrices[outcome] - cachedPrices[outcome]|` (use the **selected outcome's price**).
4. If delta > threshold → block and show updated payout + confirm/cancel.
5. Default threshold: `0.02` (2%). Never exceed `0.05`.

SWR revalidation is eventually consistent, not real-time. The fresh-fetch on submit is the last line of defense.

## Testing Guidance

**Unit tests** (`src/lib/__tests__/lmsr.test.ts`): 21 tests already pass — verify `sharesForCost` is monotone in cost, `allPrices` sums to ≈1.0 at any quantity combo, and edge cases (amount=0, large b).

**Component integration tests**: Mount with known `quantityYes/No/bParameter` + amount; assert displayed payout matches hand-computed expected value within rounding tolerance.

**Staleness guard**: Mock fresh-fetch returning `currentPrice ± threshold`; verify boundary: at exactly threshold no warning, at threshold+ε warning fires. Test both YES and NO outcome.

**Cache layer smoke test**: Hit market API twice in rapid succession; confirm `quantityYes`/`quantityNo` reflect actual DB state, not a snapshot.

## Related

- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — three-layer cache fix; prerequisite for staleness-guard correctness
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — LMSR concurrent trade locking, `referenceId` idempotency on coin ledger; note that LMSR is now also called client-side for previews (two computation paths must stay in sync)
- Wiki: `projects/virality/pages/features/getspike-parity-features.md` — Feature #2 (shipped 2026-04-16)
- Wiki: `projects/virality/pages/concepts/prediction-markets.md`
