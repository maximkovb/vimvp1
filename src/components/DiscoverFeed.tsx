"use client";

import { useState, useRef } from "react";
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
            <div key={market.id} className="snap-start h-screen">
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
