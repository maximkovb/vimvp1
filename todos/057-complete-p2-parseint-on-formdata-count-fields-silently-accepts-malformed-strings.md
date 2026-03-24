---
status: complete
priority: p2
issue_id: "057"
tags: [code-review, security, typescript, server-action]
---

# `parseInt` on FormData count fields silently accepts malformed strings

## Problem Statement

`parseInt("1e8")` returns `1` (not 100,000,000). `parseInt("100000abc")` returns `100000`. These silent truncations mean a crafted `initialViewCount=1e9` (a billion-view video submitted as scientific notation) would be parsed as `1`, producing a floor of `Math.ceil(1 * 1.2) = 2` — trivially defeated. The floor guard's correctness depends on `parseInt` faithfully parsing the full integer, but `parseInt` is the wrong tool for this. The `milestoneThresholdRaw` path already uses the more robust `Number() + BigInt()` pattern.

## Findings

- **File:** `src/lib/actions/admin.ts` — lines 281–282
- `parseInt(formData.get("initialViewCount") as string)` — silently truncates scientific notation and trailing garbage
- `parseInt("1e9")` → `1` (not 1,000,000,000)
- `parseInt("5000000malicious")` → `5000000`
- `milestoneThresholdRaw` uses `BigInt(Math.round(Number(...)))` which correctly handles `"1e8"` → `100000000`
- Identified by: security-sentinel (Medium), learnings-researcher (established pattern: use `Number()` + isNaN)

## Proposed Solutions

### Option A: Use `Number()` + integer check (Recommended)

```ts
const initialViewCountRaw = Math.round(Number((formData.get("initialViewCount") ?? "") as string));
const initialLikeCountRaw = Math.round(Number((formData.get("initialLikeCount") ?? "") as string));
if (!isFinite(initialViewCountRaw) || !isFinite(initialLikeCountRaw) ||
    initialViewCountRaw < 0 || initialLikeCountRaw < 0) {
  // either return error (if making fields required per #055) or skip floor check
}
```

`Number("1e9")` → `1000000000`. `Number("100000abc")` → `NaN`. `Number("")` → `0`.

**Pros:** Correct parsing of scientific notation. Consistent with `milestoneThresholdRaw` pattern.
**Effort:** Small

### Option B: Zod `z.coerce.number().int().min(0)`

**Pros:** Type-safe, declarative.
**Cons:** Extra dependency setup for what's essentially two lines.
**Effort:** Small

## Acceptance Criteria

- [ ] `initialViewCount=1e9` is parsed as `1,000,000,000`, not `1`
- [ ] `initialViewCount=5000000abc` is rejected (NaN / returns error)
- [ ] Normal integer strings (`"84200"`) continue to parse correctly

## Work Log

- 2026-03-24: Found by security-sentinel + learnings-researcher during code review of commit cac047a
