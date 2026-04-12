"use client";

import { useState, useRef, useEffect, createRef, useMemo, useCallback, type RefObject } from "react";
import { FeedCard, type FeedCardHandle } from "./FeedCard";
import { FeedEndGrid } from "./FeedEndGrid";
import { BetSheet } from "./BetSheet";
import { getMarketPrices } from "@/lib/market-utils";
import type { MarketStatus, QuestionType } from "@/db/schema";

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
}

interface PollData {
  marketId: string;
  viewCount: bigint | null;
  likeCount: bigint | null;
}

interface DiscoverFeedProps {
  feedMarkets: FeedMarket[];
  gridMarkets: FeedMarket[];
  pollData: PollData[];
  trendingIds: string[];
}

interface SheetState {
  open: boolean;
  marketId: string;
  prices: number[];
  initialOutcome?: number;
  title: string;
}

const CLOSED_SHEET: SheetState = {
  open: false,
  marketId: "",
  prices: [0.5, 0.5],
  initialOutcome: undefined,
  title: "",
};

export function DiscoverFeed({
  feedMarkets,
  gridMarkets,
  pollData,
  trendingIds,
}: DiscoverFeedProps) {
  const [sheet, setSheet] = useState<SheetState>(CLOSED_SHEET);
  const feedColumnRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const activeIdxRef = useRef<number>(-1);

  // Ref array resizes to match feedMarkets exactly — prevents stale refs when markets are added/removed.
  const cardRefs = useRef<RefObject<FeedCardHandle | null>[]>([]);
  if (cardRefs.current.length !== feedMarkets.length) {
    cardRefs.current = feedMarkets.map(
      (_, i) => cardRefs.current[i] ?? createRef<FeedCardHandle>()
    );
  }

  useEffect(() => {
    const container = feedColumnRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;

          // Sentinel: FeedEndGrid entered — deactivate current card
          if (el === sentinelRef.current) {
            const prev = activeIdxRef.current;
            if (prev !== -1) {
              cardRefs.current[prev]?.current?.deactivate();
              const prevEl = container.querySelector<HTMLElement>(`[data-card-index="${prev}"]`);
              if (prevEl) prevEl.removeAttribute("data-active");
            }
            activeIdxRef.current = -1;
            return;
          }

          const idx = Number(el.dataset.cardIndex);
          if (isNaN(idx)) return;

          // Deactivate only the previously active card (O(1) instead of O(n))
          const prev = activeIdxRef.current;
          if (prev !== -1 && prev !== idx) {
            cardRefs.current[prev]?.current?.deactivate();
            const prevEl = container.querySelector<HTMLElement>(`[data-card-index="${prev}"]`);
            if (prevEl) prevEl.removeAttribute("data-active");
          }

          activeIdxRef.current = idx;
          el.setAttribute("data-active", "true");
          cardRefs.current[idx]?.current?.activate();
        });
      },
      { root: container, threshold: 0.6 }
    );

    container
      .querySelectorAll<HTMLElement>("[data-card-index]")
      .forEach((el) => observer.observe(el));
    if (sentinelRef.current) observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [feedMarkets.length]);

  // O(1) trending lookup — rebuild only when trendingIds array reference changes.
  const trendingSet = useMemo(() => new Set(trendingIds), [trendingIds]);

  // Stable poll lookup — keyed by marketId.
  const pollMap = useMemo(
    () => new Map(pollData.map((p) => [p.marketId, p] as const)),
    [pollData]
  );

  // Pre-compute prices once per market per render cycle so FeedCard receives stable values.
  const pricesByMarketId = useMemo(
    () => new Map(feedMarkets.map((m) => [m.id, getMarketPrices(m)] as const)),
    [feedMarkets]
  );

  // Stable openSheet callback — depends only on setSheet (which is always stable).
  const openSheet = useCallback((market: FeedMarket, initialOutcome?: number) => {
    const prices = getMarketPrices(market);
    setSheet({
      open: true,
      marketId: market.id,
      prices,
      initialOutcome,
      title: market.title,
    });
  }, []);

  // Stable per-card onTap callbacks — recreated only when feedMarkets or openSheet changes.
  const cardTapHandlers = useMemo(
    () => feedMarkets.map((market) => (initialOutcome?: number) => openSheet(market, initialOutcome)),
    [feedMarkets, openSheet]
  );

  const closeSheet = useCallback(() => setSheet(CLOSED_SHEET), []);

  return (
    <>
      {/* Feed column — snap scroll container */}
      <div
        ref={feedColumnRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory hide-scrollbar"
      >
        {feedMarkets.map((market, index) => {
          const poll = pollMap.get(market.id);
          const prices = pricesByMarketId.get(market.id) ?? [0.5, 0.5];
          const currentCount =
            poll
              ? market.questionType === "likes"
                ? (poll.likeCount ?? null)
                : (poll.viewCount ?? null)
              : null;

          return (
            <div key={market.id} className="snap-start h-screen" data-card-index={index}>
              <FeedCard
                ref={cardRefs.current[index]}
                id={market.id}
                title={market.title}
                status={market.status}
                questionType={market.questionType}
                milestoneThreshold={market.milestoneThreshold}
                priceYes={prices[0]}
                priceNo={prices[1]}
                videoId={market.videoId}
                videoMetadata={market.videoMetadata}
                currentCount={currentCount}
                isTrending={trendingSet.has(market.id)}
                priority={index < 2}
                onTap={cardTapHandlers[index]}
              />
            </div>
          );
        })}

        {/* End grid — appears after last feed card */}
        <div ref={sentinelRef} className="snap-start min-h-screen">
          <FeedEndGrid gridMarkets={gridMarkets} />
        </div>
      </div>

      {/* Bet sheet */}
      <BetSheet
        open={sheet.open}
        onOpenChange={(v) => !v && closeSheet()}
        marketId={sheet.marketId}
        prices={sheet.prices}
        initialOutcome={sheet.initialOutcome}
        title={sheet.title}
        containerRef={feedColumnRef}
      />
    </>
  );
}
