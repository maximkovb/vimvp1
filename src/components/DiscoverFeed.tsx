"use client";

import { useState, useRef, useEffect } from "react";
import { FeedCard } from "./FeedCard";
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
  const [activeIndex, setActiveIndex] = useState(0);
  const feedColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = feedColumnRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) {
          const idx = parseInt(best.target.getAttribute("data-index") ?? "0", 10);
          setActiveIndex(idx);
        }
      },
      { root: container, threshold: 0.7 }
    );

    const cards = container.querySelectorAll("[data-feed-card]");
    cards.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — feedColumnRef is stable

  const pollMap = new Map(pollData.map((p) => [p.marketId, p]));

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
            <div key={market.id} className="snap-start h-screen" data-feed-card data-index={index}>
              <FeedCard
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
                isActive={index === activeIndex}
                onTap={(initialOutcome) => openSheet(market, initialOutcome)}
              />
            </div>
          );
        })}

        {/* End grid — appears after last feed card */}
        <div className="snap-start min-h-screen">
          <FeedEndGrid gridMarkets={gridMarkets} />
        </div>
      </div>

      {/* Bet sheet */}
      <BetSheet
        open={sheet.open}
        onOpenChange={(v) => !v && setSheet(CLOSED_SHEET)}
        marketId={sheet.marketId}
        prices={sheet.prices}
        initialOutcome={sheet.initialOutcome}
        title={sheet.title}
        containerRef={feedColumnRef}
      />
    </>
  );
}
