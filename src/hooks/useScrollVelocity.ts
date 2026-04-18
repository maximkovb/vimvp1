"use client";

import { type RefObject, useEffect, useRef } from "react";

export type Density = "minimal" | "compact" | "full";

const SCROLL_FAST_PX_S = 150;    // px/s → minimal
const SCROLL_SLOW_PX_S = 30;     // px/s → compact (below → full)
const SCROLL_SNAP_SETTLE_MS = 400; // debounce: scroll stopped → return to full

/**
 * Measures scroll velocity on a snap-scroll container and calls onDensityChange
 * whenever the velocity bucket changes. Uses a ref+callback pattern (not state)
 * so the scroll container component never re-renders during scroll.
 *
 * Constraints:
 * - Desktop guard (≥1024px) evaluated once at mount. Viewport resize from
 *   desktop → mobile mid-session will not enable the hook.
 * - scrollRef must reference a stable DOM node. If the element can change,
 *   use a useCallback ref instead.
 */
export function useScrollVelocity(
  scrollRef: RefObject<HTMLElement | null>,
  onDensityChange: (density: Density) => void,
): void {
  // Stable ref wrapper so onScroll closure always calls the latest callback
  // without needing to re-register the scroll listener when the callback changes.
  const callbackRef = useRef(onDensityChange);
  useEffect(() => { callbackRef.current = onDensityChange; });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Desktop: side HUD always shows full data. Guard is mount-time only —
    // see JSDoc constraint above.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }

    let lastScrollTop = el.scrollTop;
    let lastScrollTime = performance.now();
    let currentDensity: Density = "full";
    // Single reset timer. Two timers (snapSettle + dwell) on every scroll event
    // at 60–120 Hz caused unnecessary timer churn — collapsed to one.
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleReset() {
      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => callbackRef.current("full"), SCROLL_SNAP_SETTLE_MS);
    }

    function onScroll() {
      const now = performance.now();
      const scrollTop = el!.scrollTop;
      const deltaY = Math.abs(scrollTop - lastScrollTop);
      const deltaTime = now - lastScrollTime;

      lastScrollTop = scrollTop;
      lastScrollTime = now;

      // Skip density update when deltaTime is unmeasurably small (first event of
      // a gesture on iOS). Previously substituting FAST+1 caused a flash to
      // "minimal" at the start of every scroll gesture, including slow ones.
      if (deltaTime <= 4) {
        scheduleReset();
        return;
      }

      const velocityPxS = (deltaY / deltaTime) * 1000;

      let next: Density;
      if (velocityPxS > SCROLL_FAST_PX_S) {
        next = "minimal";
      } else if (velocityPxS > SCROLL_SLOW_PX_S) {
        next = "compact";
      } else {
        next = "full";
      }

      if (next !== currentDensity) {
        currentDensity = next;
        callbackRef.current(next);
      }

      scheduleReset();
    }

    function onScrollEnd() {
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      currentDensity = "full";
      callbackRef.current("full");
    }

    el.addEventListener("scroll", onScroll, { passive: true });

    // scrollend: Chrome 109+, Safari 16.4+, Firefox 109+.
    // Falls back to SCROLL_SNAP_SETTLE_MS debounce for older browsers.
    const supportsScrollEnd = "onscrollend" in el;
    if (supportsScrollEnd) {
      el.addEventListener("scrollend", onScrollEnd, { passive: true });
    }

    return () => {
      if (resetTimer !== null) clearTimeout(resetTimer);
      el.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) {
        el.removeEventListener("scrollend", onScrollEnd);
      }
    };
    // scrollRef is a stable React ref object — same identity across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);
}
