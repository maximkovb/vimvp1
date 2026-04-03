import { db } from "@/db";
import { markets } from "@/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getMarketPrices } from "@/lib/market-utils";
import Link from "next/link";
import { MarketCard } from "@/components/MarketCard";
import { ResolvingRailCard } from "@/components/ResolvingRailCard";

function MarketGrid({ items }: { items: (typeof markets.$inferSelect)[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((market) => {
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
  );
}

export default async function HomePage() {
  const session = await auth();

  // Parallel fetch: active/halted + recently resolved
  const [activeMarkets, resolvedMarkets] = await Promise.all([
    db
      .select()
      .from(markets)
      .where(
        or(
          eq(markets.status, "active"),
          eq(markets.status, "halted"),
          eq(markets.status, "resolving")
        )
      )
      .orderBy(desc(markets.createdAt))
      .limit(50),
    db
      .select()
      .from(markets)
      .where(eq(markets.status, "resolved"))
      .orderBy(desc(markets.resolvedAt))
      .limit(6),
  ]);

  // Split active markets: "Resolving Soon" rail vs main active grid
  const resolvingSoon = activeMarkets.filter(
    (m) => m.status === "halted" || m.status === "resolving"
  );
  const mainMarkets = activeMarkets.filter((m) => m.status === "active");

  const hasMarkets = activeMarkets.length > 0 || resolvedMarkets.length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          Predict TikTok&apos;s <span className="text-accent">Next Hit</span>
        </h1>
        <p className="text-lg text-muted max-w-2xl mx-auto">
          Bet virtual currency on whether TikTok videos will hit view and
          engagement milestones. Trade against other predictors and climb the
          leaderboard.
        </p>
        {!session?.user && (
          <Link
            href="/auth/signup"
            className="inline-block mt-6 px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
          >
            Get 1,000 Free Coins
          </Link>
        )}
      </div>

      {/* Resolving Soon rail — hidden when no markets are halted/resolving */}
      {resolvingSoon.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-lg font-semibold text-amber-500">Resolving Soon</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {resolvingSoon.map((market) => {
              const prices = getMarketPrices(market);
              return (
                <ResolvingRailCard
                  key={market.id}
                  id={market.id}
                  title={market.title}
                  priceYes={prices[0]}
                  priceNo={prices[1]}
                  resolvesAt={market.resolvesAt!}
                />
              );
            })}
          </div>
        </section>
      )}

      {mainMarkets.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-4">Active Markets</h2>
          <MarketGrid items={mainMarkets} />
        </section>
      )}

      {resolvedMarkets.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-4">Recently Resolved</h2>
          <MarketGrid items={resolvedMarkets} />
        </section>
      )}

      {!hasMarkets && (
        <div className="text-center text-muted py-16 border border-border rounded-xl bg-card">
          <p className="text-lg">No active markets yet.</p>
          <p className="text-sm mt-2">
            Markets will appear here once an admin creates them.
          </p>
        </div>
      )}
    </div>
  );
}
