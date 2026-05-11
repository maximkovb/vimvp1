import { MarketCard } from "./MarketCard";
import { getMarketPrices } from "@/lib/market-utils";
import type { MarketStatus, QuestionType } from "@/db/schema";

interface GridMarket {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  resolvesAt: Date | null;
  resolvedAt: Date | null;
  outcome: number | null;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
  } | null;
  quantityYes: string;
  quantityNo: string;
  bParameter: string;
}

interface ExploreGridProps {
  gridMarkets: GridMarket[];
}

export function ExploreGrid({ gridMarkets }: ExploreGridProps) {
  if (gridMarkets.length === 0) {
    return (
      <div className="pt-14 pb-20 flex items-center justify-center min-h-[50vh] text-muted text-sm">
        No markets yet
      </div>
    );
  }

  return (
    <div className="pt-14 pb-20 px-3">
      <div className="grid grid-cols-2 gap-3">
        {gridMarkets.map((market) => {
          const prices = getMarketPrices(market);
          return (
            <MarketCard
              key={market.id}
              id={market.id}
              title={market.title}
              status={market.status}
              questionType={market.questionType}
              milestoneThreshold={market.milestoneThreshold}
              priceYes={prices[0]}
              priceNo={prices[1]}
              resolvesAt={market.resolvesAt}
              outcome={market.outcome}
              videoMetadata={market.videoMetadata}
            />
          );
        })}
      </div>
    </div>
  );
}
