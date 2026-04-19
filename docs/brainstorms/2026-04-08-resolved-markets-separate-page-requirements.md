---
date: 2026-04-08
topic: resolved-markets-separate-page
---

# Resolved Markets Separate Page

## Problem Frame

Resolved markets are currently mixed with active markets in the home page end-of-feed grid ("All Markets"). This creates confusion — users cannot easily distinguish markets they can still bet on from those that have already settled. Resolved markets should live somewhere users can browse results without cluttering the active betting surface.

## Requirements

- R1. The home page end-of-feed grid displays only active, halted, and resolving markets. Resolved markets are excluded.
- R2. The home page end-of-feed grid heading is updated from "All Markets" to "Active Markets".
- R3. A "View resolved markets →" link appears at the bottom of the home page end grid, linking to `/resolved`.
- R4. A new public `/resolved` page displays all resolved markets in a grid using the existing `MarketCard` component, ordered by most recently resolved first.
- R5. The `/resolved` page requires no authentication.

## Success Criteria

- A user browsing the home page end grid sees only markets they can bet on.
- A user interested in past outcomes can navigate from the home page to `/resolved` in one tap.

## Scope Boundaries

- The `/history` page (personal trade history, auth-required) is not changed.
- Nav bar items are not changed.
- No pagination required for `/resolved` — a reasonable limit (e.g. the existing 12) is sufficient for now.
- No filtering or sorting controls on `/resolved` at this time.

## Key Decisions

- **Separate page over split-on-same-page**: Cleaner separation; the home page stays focused on actionable markets.
- **Link in end grid over nav bar item**: Avoids adding a 6th nav item; the natural entry point is from the active markets grid.

## Deferred to Planning

- [Affects R4][Technical] Confirm the resolved market limit (currently 12 in `page.tsx`) is appropriate for the `/resolved` page, or whether a higher limit is warranted.

## Next Steps

→ `/ce:plan` for structured implementation planning
