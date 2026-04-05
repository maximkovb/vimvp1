"use client";

import { useState, useRef } from "react";
import { FeedCard } from "./FeedCard";
import { FeedEndGrid } from "./FeedEndGrid";
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
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
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
        className="h-screen overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        <style>{`div::-webkit-scrollbar { display: none; }`}</style>

        {feedMarkets.map((market) => {
          const poll = pollMap.get(market.id);
          const prices = getMarketPrices(market);
          const currentCount =
            poll
              ? market.questionType === "like"
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
                videoMetadata={market.videoMetadata}
                currentCount={currentCount}
                isTrending={trendingIds.includes(market.id)}
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

      {/* BetSheet — rendered here so it can receive feedColumnRef for desktop positioning */}
      {/* Phase 4 will add <BetSheet ... container={feedColumnRef} /> here */}
      {sheet.open && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={closeSheet}>
          <div
            className="w-full bg-card border-t border-border rounded-t-2xl p-6 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />
            <p className="text-sm text-muted mb-4 line-clamp-2">{sheet.title}</p>
            {/* TradePanel injected in Phase 4 */}
            <button
              onClick={closeSheet}
              className="w-full py-2 text-sm text-muted border border-border rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
