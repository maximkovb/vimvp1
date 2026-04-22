---
status: pending
priority: p2
issue_id: "109"
tags: [code-review, architecture, correctness]
dependencies: []
---

# BetSheet shows stale SSR prices — use live prices from SWR response

## Problem Statement

`BetSheet` receives `prices` from `DiscoverFeed`, which were computed at server-render time. These props can be hours old by the time a user taps. The SWR fetch already retrieves fresh `priceYes`/`priceNo` from `/api/markets/[id]`, but those live values are silently discarded — only the `priceHistory` array is used (for the chart). `TradePanel` is still passed the stale `prices` prop.

## Findings

- `src/components/BetSheet.tsx:116-121`: `<TradePanel prices={prices} ...>` — `prices` is the SSR prop
- `src/components/BetSheet.tsx:37-47`: `marketData` from SWR contains `priceYes` and `priceNo` from the API
- `src/app/api/markets/[id]/route.ts`: returns `priceYes: number` and `priceNo: number` as top-level fields
- Architecture agent: "The user sees, say, 'YES 68%' on the button, but the actual execution price could be materially different"
- `TradePanel` uses `prices[outcome]` as a fallback in `handleBuy` when preview is null — stale value used for execution

## Proposed Solutions

### Option 1: Derive `livePrices` from `marketData`, fall back to prop

**Approach:**

```ts
// BetSheet.tsx — after SWR fetch
const livePrices: number[] = marketData
  ? [marketData.priceYes, marketData.priceNo]
  : prices; // SSR value is initial skeleton only

// Pass livePrices to TradePanel
<TradePanel prices={livePrices} ... />
```

**Pros:** Users always see fresh prices once the SWR response arrives; zero additional requests
**Cons:** Brief flash of SSR price before SWR resolves (same as the chart skeleton — acceptable)

**Effort:** 15 minutes
**Risk:** Low

## Recommended Action

Implement Option 1. The SWR fetch already runs; this is a one-line derivation.

## Technical Details

**Affected files:**
- `src/components/BetSheet.tsx:116` — derive `livePrices` from `marketData`, pass to TradePanel

**Related:** `src/app/api/markets/[id]/route.ts` — already returns `priceYes`/`priceNo`

## Acceptance Criteria

- [ ] YES/NO percentage buttons in the bet sheet reflect the price from the API response, not the SSR value
- [ ] During loading, the SSR price is shown as a skeleton value (no regression)

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (architecture-strategist agent)
