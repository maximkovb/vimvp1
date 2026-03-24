---
status: complete
priority: p2
issue_id: "058"
tags: [code-review, architecture, server-action, market-creation]
---

# Server floor formula weaker than client floor formula — divergent enforcement

## Problem Statement

The client and server enforce different floor formulas:

| Layer | Formula |
|---|---|
| Client (`computeMilestoneFloor`) | `max(0.1× anchor, ceil(currentAnalytics × 1.2))` |
| Server (`createMarket` lines 286–287) | `ceil(initialCount × 1.2)` only |

The server's guard omits the `0.1× anchor` component. This means a milestone that the client slider would block (below `0.1× anchor`) can be submitted directly and will pass server validation if it clears the analytics component alone. The two layers enforce different rules about the same business constraint.

## Findings

- **File:** `src/lib/actions/admin.ts` — lines 286–291
- Server: `Math.ceil(initialCount * 1.2)` — missing `anchor * 0.1` term
- Client: `computeMilestoneFloor(anchor, current)` = `max(0.1× anchor, ceil(current × 1.2))`
- A milestone of `0.05× anchor` with low `currentAnalytics` passes the server but would be blocked by the slider
- `computeMilestoneFloor` is already exported from `helpers.ts` — importable in the server action
- Identified by: architecture-strategist, agent-native-reviewer, kieran-typescript-reviewer

## Proposed Solutions

### Option A: Import `computeMilestoneFloor` in the server action (Recommended)

Move `computeMilestoneFloor` to `src/lib/market-utils.ts` (already exists). Import and call it in `createMarket`, passing `anchorMilestone` as a hidden field or deriving it from the contract recommendation stored in the session.

Challenge: the anchor requires the AI recommendation value which is only known client-side after the fetch. Options:
- Add `anchorMilestone` as a hidden form field (validated as a positive integer)
- Accept that the server guard uses only the analytics component and document it explicitly

**Pros:** Single source of truth for the floor formula.
**Effort:** Medium (needs anchor as a form field or shared constant)

### Option B: Document the intentional divergence

Add a comment in `createMarket` explaining that the server enforces only the analytics component (`ceil(current × 1.2)`) because the anchor is not trusted server-side, and that the client enforces the stricter two-component floor as a UX constraint.

**Pros:** Zero code change; honest about the design.
**Cons:** The documented business rule (`max(0.1× anchor, ceil(current × 1.2))`) is not server-enforced.
**Effort:** Trivial

## Acceptance Criteria

- [ ] Either the server and client use the same floor formula, OR the divergence is explicitly documented with a comment in the server action
- [ ] If unified: submitting a milestone below `0.1× anchor` but above `1.2× current` returns a server error

## Work Log

- 2026-03-24: Found by architecture-strategist + agent-native-reviewer during code review of commit cac047a
