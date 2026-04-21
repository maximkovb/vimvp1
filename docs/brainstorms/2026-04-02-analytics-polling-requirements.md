---
date: 2026-04-02
topic: analytics-polling
---

# Analytics Polling & Auto-Resolution

## Problem Frame
TikTok market stats (view count, like count) are fetched once at market creation and never updated. The view/like trajectory chart shows stale data for the entire life of a market. Additionally, markets never resolve early even when the milestone is clearly surpassed — users must wait until the `resolvesAt` deadline regardless of outcome.

## Requirements
- R1. All active and halted TikTok markets must be polled for view and like counts every 10 minutes.
- R2. The view/like trajectory chart on the market detail page must reflect the latest poll data.
- R3. If a poll detects that the market's milestone threshold has been crossed (views or likes ≥ `milestoneThreshold`), the market must be resolved immediately — not at the scheduled `resolvesAt` deadline.
- R4. The polling interval in both the scheduler config and the poll-guard logic must be 10 minutes.

## Success Criteria
- A market's trajectory chart shows a new data point at least every 10 minutes while the market is active or halted.
- A market whose video surpasses the milestone is resolved (status = "resolved", outcome set, payouts distributed) within one polling cycle of the threshold being crossed.
- Markets that never hit the milestone still resolve at their scheduled `resolvesAt` time via the existing mechanism.

## Scope Boundaries
- TikTok markets only — YouTube support is out of scope for the MVP.
- The frontend polling interval (SWR `refreshInterval`) is out of scope — it can remain at 60 seconds since it only reads already-stored poll data.
- No changes to how the oracle determines YES/NO outcome — existing logic in `resolveMarket()` is used as-is.

## Key Decisions
- **Immediate resolution on threshold crossed**: Resolve in the same poll run that first detects the milestone is surpassed, rather than waiting for the `resolve-markets` cron. Keeps the resolution lag under one poll cycle.
- **10-minute interval**: Changed from the current 15 minutes per user requirement. The Vercel cron schedule and the in-code `shouldPoll` guard must both be updated.

## Dependencies / Assumptions
- `resolveMarket()` in `lib/oracle.ts` is idempotent and can be called from the poll cron safely.
- The existing `resolve-markets` cron continues to handle time-based resolution; early resolution is additive behavior in the poll cron.

## Outstanding Questions

### Deferred to Planning
- [Affects R3][Technical] Should the poll cron call `resolveMarket()` directly, or set status to "resolving" and rely on the next `resolve-markets` cron run (~5 min lag)? Direct call is faster; delegating preserves separation of concerns.
- [Affects R1][Needs research] Does TikAPI rate limiting allow 10-minute polling for all active markets without hitting the 60 req/min cap? The existing 1.1s delay between requests may need adjustment if the market count grows.

## Next Steps
→ `/ce:plan` for structured implementation planning
