"use client";

import { type RefObject, useEffect, useState } from "react";

export type Density = "minimal" | "compact" | "full";

const SCROLL_FAST_PX_S = 150;  // px/s threshold → minimal
const SCROLL_SLOW_PX_S = 30;   // px/s threshold → compact (below this → full)
const SCROLL_SNAP_SETTLE_MS = 400; // debounce to detect snap-settled (scrollend fallback)
const SCROLL_DWELL_MS = 2000;  // dwell without scroll → force full

export function useScrollVelocity(
  scrollRef: RefObject<HTMLElement | null>
): Density {
  const [density, setDensity] = useState<Density>("full");

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Desktop: never change density — side HUD always shows full data
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      return;
    }

    let lastScrollTop = el.scrollTop;
    let lastScrollTime = performance.now();
    let snapSettleTimer: ReturnType<typeof setTimeout> | null = null;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;

    function resetToFull() {
      setDensity("full");
    }

    function clearTimers() {
      if (snapSettleTimer !== null) {
        clearTimeout(snapSettleTimer);
        snapSettleTimer = null;
      }
      if (dwellTimer !== null) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    }

    function onScroll() {
      const now = performance.now();
      const scrollTop = el!.scrollTop;
      const deltaY = Math.abs(scrollTop - lastScrollTop);
      const deltaTime = now - lastScrollTime;

      lastScrollTop = scrollTop;
      lastScrollTime = now;

      // Avoid division by near-zero time (first event or very fast batch)
      const velocityPxS = deltaTime > 4 ? (deltaY / deltaTime) * 1000 : SCROLL_FAST_PX_S + 1;

      // Bucket velocity → density
      let next: Density;
      if (velocityPxS > SCROLL_FAST_PX_S) {
        next = "minimal";
      } else if (velocityPxS > SCROLL_SLOW_PX_S) {
        next = "compact";
      } else {
        next = "full";
      }
      setDensity((prev) => (prev !== next ? next : prev));

      // Reset timers on every scroll event
      clearTimers();

      // Snap-settle debounce: return to full after scroll stops
      snapSettleTimer = setTimeout(resetToFull, SCROLL_SNAP_SETTLE_MS);

      // Dwell lock: force full after 2s of inactivity regardless
      dwellTimer = setTimeout(resetToFull, SCROLL_DWELL_MS);
    }

    function onScrollEnd() {
      clearTimers();
      resetToFull();
    }

    el.addEventListener("scroll", onScroll, { passive: true });

    // scrollend is available in Chrome 109+, Safari 16.4+, Firefox 109+
    // Falls back to the debounce timer for older browsers
    const supportsScrollEnd = "onscrollend" in el;
    if (supportsScrollEnd) {
      el.addEventListener("scrollend", onScrollEnd, { passive: true });
    }

    return () => {
      clearTimers();
      el.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) {
        el.removeEventListener("scrollend", onScrollEnd);
      }
    };
  }, [scrollRef]);

  return density;
}
