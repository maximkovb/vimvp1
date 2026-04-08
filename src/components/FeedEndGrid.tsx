"use client";

import Link from "next/link";
import { MarketCard } from "./MarketCard";
import { getMarketPrices } from "@/lib/market-utils";
import type { MarketStatus, QuestionType } from "@/db/schema";

interface GridMarket {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  priceYes?: number;
  priceNo?: number;
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

interface FeedEndGridProps {
  gridMarkets: GridMarket[];
}

export function FeedEndGrid({ gridMarkets }: FeedEndGridProps) {
  if (gridMarkets.length === 0) return null;

  return (
    <div className="px-4 py-8">
      <h2 className="text-lg font-semibold mb-4 text-foreground">Active Markets</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
      <div className="mt-4 text-center">
        <Link href="/resolved" className="text-sm text-accent hover:underline">
          View resolved markets →
        </Link>
      </div>
    </div>
  );
}
