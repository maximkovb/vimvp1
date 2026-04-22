import { db } from "@/db";
import { markets } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { MarketCard } from "@/components/MarketCard";
import { getMarketPrices } from "@/lib/market-utils";

export default async function ResolvedMarketsPage() {
  const resolvedMarkets = await db
    .select()
    .from(markets)
    .where(eq(markets.status, "resolved"))
    .orderBy(sql`resolved_at DESC NULLS LAST`)
    .limit(50);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Resolved Markets</h1>

      {resolvedMarkets.length === 0 ? (
        <p className="text-sm text-muted">No resolved markets yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {resolvedMarkets.map((market) => {
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
      )}
    </div>
  );
}
