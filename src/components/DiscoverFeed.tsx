"use client";

import { useState, useRef, useEffect, createRef, type RefObject } from "react";
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

interface GridMarket extends FeedMarket {
  // same shape, used for the end grid
}

interface PollData {
  marketId: string;
  viewCount: bigint | null;
  likeCount: bigint | null;
}

interface DiscoverFeedProps {
  feedMarkets: FeedMarket[];
  gridMarkets: GridMarket[];
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

  // Stable ref array — one slot per feed card, created on demand
  const cardRefs = useRef<RefObject<FeedCardHandle | null>[]>([]);
  feedMarkets.forEach((_, i) => {
    if (!cardRefs.current[i]) cardRefs.current[i] = createRef<FeedCardHandle>();
  });

  useEffect(() => {
    const container = feedColumnRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;

          // Sentinel: FeedEndGrid entered — deactivate all cards
          if (el === sentinelRef.current) {
            cardRefs.current.forEach((ref) => ref.current?.deactivate());
            return;
          }

          const idx = Number((el as HTMLElement).dataset.cardIndex);
          if (isNaN(idx)) return;

          // Deactivate every other card, then activate the entering one
          cardRefs.current.forEach((ref, i) => {
            if (i !== idx) ref.current?.deactivate();
          });
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

  const pollMap = new Map(
    pollData.map((p) => ({
      marketId: p.marketId,
      viewCount: p.viewCount,
      likeCount: p.likeCount,
    })).map((p) => [p.marketId, p])
  );

  function openSheet(market: FeedMarket, initialOutcome?: number) {
    const prices = getMarketPrices(market);
    setSheet({
      open: true,
      marketId: market.id,
      prices,
      initialOutcome,
      title: market.title,
    });
  }

  function closeSheet() {
    setSheet(CLOSED_SHEET);
  }

  return (
    <>
      {/* Feed column — snap scroll container */}
      <div
        ref={feedColumnRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory hide-scrollbar"
      >
        {feedMarkets.map((market, index) => {
          const poll = pollMap.get(market.id);
          const prices = getMarketPrices(market);
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
                isTrending={trendingIds.includes(market.id)}
                priority={index < 2}
                onTap={(initialOutcome) => openSheet(market, initialOutcome)}
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
