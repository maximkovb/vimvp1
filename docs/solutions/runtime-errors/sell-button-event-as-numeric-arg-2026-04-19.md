---
title: SellButton onClick Passes MouseEvent as Shares Argument — Infinity Balance Update Crash
date: 2026-04-19
category: docs/solutions/runtime-errors
module: Portfolio / Trading
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - "POST /portfolio 500 — sellShares called with null/NaN shares"
  - "Failed query: UPDATE users SET balance = balance + Infinity"
  - "Ghost rows in Active Positions showing 0.0 or 0.x shares after sell"
root_cause: wrong_api
resolution_type: code_fix
severity: critical
tags: [sell-button, onclick, event-object, nan, infinity, floating-point, portfolio, positions]
---

# SellButton onClick Passes MouseEvent as Shares Argument — Infinity Balance Update Crash

## Problem

Clicking "Confirm Sell" in the sell modal triggered a 500 server error because the `handleSell`
function received the MouseEvent as its first argument instead of `undefined`, bypassing the
default parameter and sending `NaN` shares to `sellShares()`. The server then computed a refund
of `Infinity` and attempted to store it in the database.

A secondary issue caused ghost "0.x shares" rows to persist in Active Positions after partial
sells, because the `toFixed(1)` rounding in the input initialization could leave tiny float
remainders above the zero-out threshold.

## Symptoms

- Server log: `sellShares("...", 0, null)` — shares argument shown as null/NaN in logs
- DB error: `Failed query: UPDATE users SET balance = balance + Infinity`
- Active Positions table showing rows with 0.0 or 0.1 shares and no P/L after selling

## What Didn't Work

- The original `handleSell` had a default parameter `sharesToSell = parseFloat(shares)`. This
  looks correct but fails when `onClick={handleSell}` is used directly — React passes the
  MouseEvent as the first argument, which overrides the default (defaults only fire on
  `undefined`, not on a MouseEvent object). `Math.min(MouseEvent, maxShares)` → `NaN`.

## Solution

**Primary fix** — remove the parameterized signature from the handler; read shares state directly:

```ts
// Before (broken — onClick={handleSell} passes MouseEvent as sharesToSell)
function handleSell(sharesToSell = parseFloat(shares)) {
  const clamped = Math.min(sharesToSell, maxShares);
  ...
}

// After — no parameter; reads state directly, clamps to maxShares
function handleSell() {
  const numShares = parseFloat(shares);
  if (!numShares || numShares <= 0) { setError("Enter a valid amount"); return; }
  const clamped = Math.min(numShares, maxShares);  // absorbs float rounding
  startTransition(async () => {
    const result = await sellShares(marketId, outcome, clamped);
    ...
  });
}
```

**Secondary fix** — raise the zero-out threshold in `sellShares` so sub-cent remainders from
float arithmetic get stored as `"0"` rather than `"0.044000"`:

```ts
// src/lib/actions/trade.ts
// Before
if (remainingShares <= 0.000001) { ... set shares to "0" }

// After
if (remainingShares <= 0.01) { ... set shares to "0" }
```

**Tertiary fix** — portfolio query uses a numeric cast instead of string equality so residual
non-zero fractions are filtered even if threshold logic is bypassed:

```ts
// src/app/portfolio/page.tsx
// Before
ne(positions.shares, "0")

// After
sql`CAST(${positions.shares} AS DECIMAL) > 0.001`
```

Also added a "Max" button to `SellButton` and changed the input to use full-precision
`String(maxShares)` instead of `maxShares.toFixed(1)` to prevent the input from rounding up
and causing a "You only have X shares" rejection from the server.

## Why This Works

JavaScript default parameters only substitute when the argument is strictly `undefined`. When
a button's `onClick` receives `{onClick: handleSell}`, React calls `handleSell(MouseEvent)`,
so the default never fires. The fix avoids parameterizing the handler entirely and reads state
directly, which is the idiomatic React pattern for click handlers that don't need arguments.

The `toFixed(1)` ghost-row chain: `maxShares = 5.678` → input shows `"5.7"` → sell 5.7 fails
(`5.7 > 5.678`) OR `maxShares = 5.44` → input shows `"5.4"` → remainder `0.04` stays because
`0.04 > 0.000001`. Raising the threshold to `0.01` and using the numeric cast filter catches
both cases.

## Prevention

- Never use `onClick={handler}` when `handler` has a default numeric parameter. Wrap it:
  `onClick={() => handler()}` or remove the parameter and read state directly.
- When a server action receives a numeric argument from client state, add a `Number.isFinite`
  guard before using it in arithmetic:
  ```ts
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0)
    return { error: "Invalid shares amount" };
  ```
- Avoid `toFixed(n)` for initializing numeric inputs from stored values — use `String(value)` or
  `value.toString()` to preserve full precision and prevent rounding-induced validation failures.

## Related Issues

- `src/components/SellButton.tsx` — primary fix location
- `src/lib/actions/trade.ts` — threshold fix and (recommended) Infinity guard
- `src/app/portfolio/page.tsx` — numeric cast filter for ghost-row cleanup
