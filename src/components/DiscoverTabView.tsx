"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { DiscoverFeed } from "./DiscoverFeed";
import { ExploreGrid } from "./ExploreGrid";
import type { MarketStatus, QuestionType, ProjectionLabel } from "@/db/schema";

interface FeedMarket {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  resolvesAt: Date | null;
  resolvedAt: Date | null;
  outcome: number | null;
  createdAt: Date;
  videoId: string;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
    playUrl?: string | null;
    creatorId?: string | null;
  } | null;
  quantityYes: string;
  quantityNo: string;
  bParameter: string;
  projectionLabel?: ProjectionLabel | null;
}

interface PollData {
  marketId: string;
  viewCount: number | null;
  likeCount: number | null;
}

interface DiscoverTabViewProps {
  feedMarkets: FeedMarket[];
  gridMarkets: FeedMarket[];
  pollData: PollData[];
  trendingIds?: string[];
  userPositionIds?: string[];
}

type ActiveTab = "feed" | "grid";

const STORAGE_KEY = "cm_mobile_discover_mode";

// Percentage offset for each tab (container is 200vw)
function tabOffset(tab: ActiveTab): string {
  return tab === "feed" ? "0%" : "-50%";
}

export function DiscoverTabView({
  feedMarkets,
  gridMarkets,
  pollData,
  trendingIds,
  userPositionIds,
}: DiscoverTabViewProps) {
  // Default to 'feed'; hydrate from localStorage in useEffect to avoid SSR mismatch
  const [activeTab, setActiveTab] = useState<ActiveTab>("feed");
  const paneRef = useRef<HTMLDivElement>(null);

  // Gesture state — kept in refs so touch handlers never go stale
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const axisRef = useRef<"horizontal" | "vertical" | null>(null);
  const isDraggingRef = useRef(false);
  const dragDxRef = useRef(0);
  const activeTabRef = useRef<ActiveTab>("feed");

  // Sync activeTabRef whenever state changes
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "grid") {
      setActiveTab("grid");
    }
  }, []);

  const switchTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    activeTabRef.current = tab;
    localStorage.setItem(STORAGE_KEY, tab);
  }, []);

  // Apply transform when active tab changes via tap (not swipe — swipe manages its own transform)
  useEffect(() => {
    const el = paneRef.current;
    if (!el || isDraggingRef.current) return;
    el.style.transition = "transform 0.3s ease-out";
    el.style.transform = `translateX(${tabOffset(activeTab)})`;
  }, [activeTab]);

  // Touch gesture: axis detection → horizontal drag → commit/cancel on release
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      startXRef.current = t.clientX;
      startYRef.current = t.clientY;
      axisRef.current = null;
      isDraggingRef.current = false;
      dragDxRef.current = 0;
      // Remove transition so finger-tracking is instant
      el!.style.transition = "none";
    }

    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      const dx = t.clientX - startXRef.current;
      const dy = t.clientY - startYRef.current;

      // Determine axis from the first 8px of movement
      if (axisRef.current === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          axisRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        }
        return;
      }

      if (axisRef.current !== "horizontal") return;

      // Prevent the browser from scrolling vertically during a horizontal drag
      e.preventDefault();
      isDraggingRef.current = true;
      dragDxRef.current = dx;

      // Convert px drag to % of the 200vw container
      const basePercent = activeTabRef.current === "feed" ? 0 : -50;
      const dragPercent = (dx / (2 * window.innerWidth)) * 100;
      const clamped = Math.max(-50, Math.min(0, basePercent + dragPercent));
      el!.style.transform = `translateX(${clamped}%)`;
    }

    function onTouchEnd() {
      // Re-enable transition for snap
      el!.style.transition = "transform 0.3s ease-out";

      if (axisRef.current !== "horizontal" || !isDraggingRef.current) {
        // Vertical swipe or no drag: snap back to current tab position
        el!.style.transform = `translateX(${tabOffset(activeTabRef.current)})`;
        isDraggingRef.current = false;
        return;
      }

      const dx = dragDxRef.current;
      const current = activeTabRef.current;

      if (Math.abs(dx) > 50) {
        if (dx < 0 && current === "feed") {
          // Swiped left on For You → go to Explore
          switchTab("grid");
          el!.style.transform = "translateX(-50%)";
        } else if (dx > 0 && current === "grid") {
          // Swiped right on Explore → go to For You
          switchTab("feed");
          el!.style.transform = "translateX(0%)";
        } else {
          // Already at boundary — snap back
          el!.style.transform = `translateX(${tabOffset(current)})`;
        }
      } else {
        // Below threshold — snap back
        el!.style.transform = `translateX(${tabOffset(current)})`;
      }

      isDraggingRef.current = false;
      axisRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [switchTab]);

  return (
    <>
      {/* ── Mobile layout: fixed tab bar + two-pane swipeable container ── */}
      <div className="md:hidden">
        {/* Tab bar — floats over content at the top of the screen */}
        <div
          className="fixed top-0 left-0 right-0 z-50"
          style={{ paddingTop: "var(--safe-area-top)" }}
        >
          {/* Gradient background so feed thumbnails show through */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/30 to-transparent pointer-events-none" />

          {/* Tab row — centered, equal-width tabs for clean underline slide */}
          <div className="relative flex justify-center">
            <div className="relative flex w-40">
              <button
                onClick={() => switchTab("feed")}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors duration-200 ${
                  activeTab === "feed" ? "text-foreground" : "text-muted"
                }`}
              >
                For You
              </button>
              <button
                onClick={() => switchTab("grid")}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors duration-200 ${
                  activeTab === "grid" ? "text-foreground" : "text-muted"
                }`}
              >
                Explore
              </button>

              {/* Sliding underline — translates 100% of its width to align with the active tab */}
              <div
                className="absolute bottom-0 left-0 w-1/2 h-0.5 bg-foreground rounded-full"
                style={{
                  transform: `translateX(${activeTab === "grid" ? "100%" : "0%"})`,
                  transition: "transform 0.3s ease-out",
                }}
              />
            </div>
          </div>
        </div>

        {/* Viewport clipper — clips the 200vw pane row to the screen width */}
        <div className="fixed inset-0 overflow-hidden">
          {/* Two-pane row — 200vw wide, shifted horizontally by translateX */}
          <div
            ref={paneRef}
            className="flex h-full"
            style={{
              width: "200vw",
              transform: `translateX(${tabOffset(activeTab)})`,
              transition: "transform 0.3s ease-out",
              willChange: "transform",
            }}
          >
            {/* For You pane */}
            <div className="w-screen h-full overflow-hidden">
              <DiscoverFeed
                feedMarkets={feedMarkets}
                gridMarkets={gridMarkets}
                pollData={pollData}
                userPositionIds={userPositionIds}
              />
            </div>

            {/* Explore pane */}
            <div className="w-screen h-full overflow-y-auto">
              <ExploreGrid gridMarkets={gridMarkets} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop: DiscoverFeed directly, no tab bar or pane switcher ── */}
      <div className="hidden md:block">
        <DiscoverFeed
          feedMarkets={feedMarkets}
          gridMarkets={gridMarkets}
          pollData={pollData}
          userPositionIds={userPositionIds}
        />
      </div>
    </>
  );
}
