---
status: pending
priority: p3
issue_id: "132"
tags: [code-review, performance]
dependencies: []
---

# poll-tiktok cron: no dirty-check before videoMetadata UPDATE

## Problem Statement

The cron's `videoMetadata` update now fires on every successful poll cycle as long as `stats.playUrl` or `stats.thumbnailUrl` is non-empty — which is nearly always. The old code had a natural change-detection property: the thumbnail regex guard rarely passed once URLs stabilized. The new code unconditionally writes the same values on every 10-minute cycle even when nothing has changed.

At current scale (small number of active markets) this is not a real problem. It becomes meaningful if market count grows past ~100.

## Findings

**Performance agent:** At 50 active markets, this is ~50 unnecessary JSONB writes per 10-minute cycle, ~7,200/day. CDN URLs rotate approximately once per 24h, so the ratio of useful writes to total writes is roughly 1:144. Adding a dirty-check reduces DB load by ~143x in steady state.

The concern is secondary to the correctness purpose of the fix (keeping `playUrl` fresh), but is a simple improvement with no functional trade-off.

## Proposed Solutions

### Option A — Add value comparison before UPDATE (Recommended)

```ts
const currentThumbnail = market.videoMetadata?.thumbnail;
const currentPlayUrl = market.videoMetadata?.playUrl;

const thumbnailChanged = newThumbnail !== undefined && newThumbnail !== currentThumbnail;
const playUrlChanged = newPlayUrl !== undefined && newPlayUrl !== currentPlayUrl;

if (thumbnailChanged || playUrlChanged) {
  await db.update(markets).set({ videoMetadata: { ... } }).where(...);
}
```

**Pros:** Reduces write volume by ~143x. No behavioral change — only writes when values differ.
**Cons:** Slight added complexity. Requires reading `market.videoMetadata` (already in memory from the initial SELECT).
**Effort:** Small. **Risk:** Very low.

### Option B — Accept current behavior

Writes on every poll. Fine at current scale. Revisit if market count grows.

**Pros:** Zero code change.
**Cons:** Inefficient. Creates a Neon billing surface if market count grows.
**Effort:** None. **Risk:** None now.

## Recommended Action
Option A when convenient — it's a simple 2-line guard. Not urgent at current scale.

## Technical Details
- **Affected file:** `src/app/api/cron/poll-tiktok/route.ts` — the `if (stats !== null)` update block
- `market.videoMetadata` is already in memory from the initial `SELECT` at line 37

## Acceptance Criteria
- [ ] UPDATE is not issued when both `thumbnail` and `playUrl` are unchanged
- [ ] UPDATE IS issued when either value differs from the stored value
- [ ] Behaviour is unchanged when `market.videoMetadata` is null (always writes the fallback + new values)

## Work Log
- 2026-04-11 — Created from ce:review of `fix(cron): refresh playUrl in poll-tiktok alongside thumbnail`
