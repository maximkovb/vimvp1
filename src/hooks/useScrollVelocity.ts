"use client";

import { type RefObject, useEffect, useState } from "react";

export type Density = "minimal" | "compact" | "full";

const SCROLL_FAST_PX_S = 150;   // px/s → minimal
const SCROLL_SLOW_PX_S = 30;    // px/s → compact (below → full)
const SCROLL_SNAP_SETTLE_MS = 400; // debounce: scroll stopped → return to full

export function useScrollVelocity(
  scrollRef: RefObject<HTMLElement | null>
): Density {
  const [density, setDensity] = useState<Density>("full");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Desktop: side HUD always shows full data. Evaluated once at mount —
    // viewport resize from desktop → mobile mid-session will not enable the hook.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }

    let lastScrollTop = el.scrollTop;
    let lastScrollTime = performance.now();
    // Single reset timer — replaces the previous dual snapSettle+dwell pattern.
    // Two timers on every scroll event at 60–120Hz caused unnecessary timer churn.
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleReset() {
      if (resetTimer !== null) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setDensity("full"), SCROLL_SNAP_SETTLE_MS);
    }

    function onScroll() {
      const now = performance.now();
      const scrollTop = el!.scrollTop;
      const deltaY = Math.abs(scrollTop - lastScrollTop);
      const deltaTime = now - lastScrollTime;

      lastScrollTop = scrollTop;
      lastScrollTime = now;

      // Skip density update when deltaTime is unmeasurably small (first event of
      // a gesture on iOS). Previously this substituted FAST+1 velocity, causing a
      // flash to "minimal" at the start of every scroll gesture including slow ones.
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
      setDensity((prev) => (prev !== next ? next : prev));

      scheduleReset();
    }

    function onScrollEnd() {
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      setDensity("full");
    }

    el.addEventListener("scroll", onScroll, { passive: true });

    // scrollend is available in Chrome 109+, Safari 16.4+, Firefox 109+.
    // Falls back to the SCROLL_SNAP_SETTLE_MS debounce for older browsers.
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
    // If the underlying DOM node can change, refactor to a useCallback ref instead.
  }, [scrollRef]);

  return density;
}
