---
date: 2026-05-10
topic: for-you-explore-tabs
---

# "For You" / "Explore" Tab Navigation

## Summary

Replace the two icon-based view toggle (feed/grid) with a TikTok-style "For You" / "Explore" tab bar at the top of the mobile discover screen. Users can tap tabs or swipe horizontally to switch between views, with a smooth slide transition.

---

## Problem Frame

The current view toggle is two small icons in the top-right corner — not discoverable, not labeled, and doesn't communicate what each view actually is. There's no gesture to switch views; users must find and tap the icon. The language (icons only) doesn't match the product's content model — "For You" and "Explore" are the actual concepts, not abstract toggle states.

---

## Requirements

**Tab bar**

- R1. The top of the mobile discover screen displays two labeled tabs: "For You" on the left and "Explore" on the right.
- R2. A sliding underline indicator tracks the active tab.
- R3. The existing icon-based `ModeToggleOverlay` is removed from both the feed and grid views.
- R4. The tab bar is shared across both views — the same element is visible regardless of which view is active.

**View switching**

- R5. Tapping a tab switches to that view.
- R6. Swiping left on the "For You" view switches to "Explore"; swiping right on "Explore" switches to "For You".
- R7. The transition between views is a horizontal slide animation — content slides in from the left or right depending on direction of travel.
- R8. The active tab and view state is persisted to `localStorage` (key: `cm_mobile_discover_mode`) so the user returns to the same view on next visit.

**Existing behavior preserved**

- R9. The Explore view's sort chips (Trending, Ending Soon, High Vol, New) remain visible below the tab bar when the Explore tab is active.
- R10. The vertical snap-scroll gesture on the For You feed is unaffected by the horizontal swipe-to-switch gesture.
- R11. Pull-to-refresh on the Explore view continues to function.

---

## Acceptance Examples

- AE1. **Covers R6, R7.** Given the user is on the "For You" tab, when they swipe left, the screen transitions with a leftward slide to "Explore" and the tab underline moves to the right.
- AE2. **Covers R6, R7.** Given the user is on the "Explore" tab, when they swipe right, the screen transitions with a rightward slide to "For You" and the tab underline moves to the left.
- AE3. **Covers R10.** Given the user is on the "For You" tab, vertical swipes advance or retreat between feed cards normally with no view switch.
- AE4. **Covers R8.** Given the user last left on "Explore", when they return to the discover screen, "Explore" is the active view.

---

## Success Criteria

- The view toggle is immediately understandable to a new user without any hint or explanation.
- Switching views via swipe feels as fluid as swiping between TikTok's For You and Following feeds — no jank, no layout flash.
- Existing feed and grid behaviors (snap-scroll, pull-to-refresh, sort chips) are unaffected.

---

## Scope Boundaries

- No third tab (Following, Saved, etc.) — two tabs only.
- No changes to bottom navigation structure.
- No changes to feed card behavior or grid card behavior.
- No changes to the desktop/web layout.

---

## Key Decisions

- **Labels over icons:** "For You" and "Explore" are the actual product concepts — labels communicate the content model directly where icons required interpretation.
- **Horizontal slide (not fade):** Directional animation communicates spatial relationship between tabs, matching user's swipe direction and matching established patterns (TikTok, Instagram tabs).

---

## Dependencies / Assumptions

- The horizontal swipe-to-switch gesture must not conflict with the existing vertical snap-scroll in the feed view. These are orthogonal axes, so no conflict is expected, but gesture disambiguation should be verified during implementation.
- The tab bar needs to absorb the header elements currently in the grid view (logo, search link) — the shared top bar structure should accommodate both the tabs and those persistent elements.
