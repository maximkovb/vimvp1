import { db } from "@/db";
import { markets, trades, priceSnapshots, youtubePolls } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { price, allPrices } from "@/lib/lmsr";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { VideoStatsChart } from "@/components/VideoStatsChart";
import { VideoDescription } from "@/components/VideoDescription";
import { ChannelHistorySection } from "@/components/ChannelHistorySection";
import { MarketStatusBadge } from "@/components/MarketStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { Suspense } from "react";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, id))
    .limit(1);

  if (!market) notFound();

  const quantities = [
    parseFloat(market.quantityYes),
    parseFloat(market.quantityNo),
  ];
  const b = parseFloat(market.bParameter);
  const prices = allPrices(quantities, b);

  // Fetch recent trades
  const recentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.marketId, id))
    .orderBy(desc(trades.createdAt))
    .limit(20);

  // Fetch price history for chart
  const history = await db
    .select()
    .from(priceSnapshots)
    .where(eq(priceSnapshots.marketId, id))
    .orderBy(priceSnapshots.recordedAt)
    .limit(500);

  const chartData = history.map((s) => ({
    time: Math.floor(s.recordedAt.getTime() / 1000),
    value: parseFloat(s.priceYes),
  }));

  // Fetch poll history for video stats trajectory chart
  const pollHistory = await db
    .select()
    .from(youtubePolls)
    .where(eq(youtubePolls.marketId, id))
    .orderBy(youtubePolls.polledAt)
    .limit(500);

  // Build chart data — skip null rows (deleted/private video), convert BigInt to number
  const statsChartData = pollHistory
    .filter((p) =>
      market.questionType === "views" ? p.viewCount !== null : p.likeCount !== null
    )
    .map((p) => ({
      time: Math.floor(p.polledAt.getTime() / 1000),
      value: Number(market.questionType === "views" ? p.viewCount! : p.likeCount!),
    }));

  const milestoneNumber = Number(market.milestoneThreshold);

  const videoMetadata = market.videoMetadata;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <MarketStatusBadge status={market.status} />
        {market.resolvesAt && <CountdownTimer target={market.resolvesAt} />}
      </div>

      <h1 className="text-2xl font-bold mb-6">{market.title}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: video + intelligence + chart */}
        <div className="lg:col-span-2 space-y-6">
          {/* YouTube embed */}
          <div className="aspect-video bg-card rounded-xl overflow-hidden border border-border">
            <iframe
              src={`https://www.youtube.com/embed/${market.youtubeVideoId}`}
              title={videoMetadata?.title || market.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* Video Intelligence */}

          {/* Description */}
          {videoMetadata?.description && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-sm font-medium text-muted mb-3">
                About This Video
              </h2>
              <VideoDescription description={videoMetadata.description} />
            </div>
          )}

          {/* View / Like trajectory */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">
              {market.questionType === "views" ? "View" : "Like"} Count Trajectory
            </h2>
            {statsChartData.length > 0 ? (
              <VideoStatsChart
                data={statsChartData}
                milestone={milestoneNumber}
                metricLabel={market.questionType}
              />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted text-sm">
                Poll data not yet available — chart will appear after the first polling interval
              </div>
            )}
          </div>

          {/* Channel history */}
          {videoMetadata?.channelId && (
            <Suspense
              fallback={
                <div className="bg-card border border-border rounded-xl p-4">
                  <h2 className="text-sm font-medium text-muted mb-3">
                    Channel History
                  </h2>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-shrink-0 w-48 rounded-lg border border-border bg-background overflow-hidden animate-pulse"
                      >
                        <div className="w-full aspect-video bg-card" />
                        <div className="p-2 space-y-1.5">
                          <div className="h-3 bg-card rounded w-4/5" />
                          <div className="h-3 bg-card rounded w-3/5" />
                          <div className="h-2.5 bg-card rounded w-2/5 mt-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
              <ChannelHistorySection channelId={videoMetadata.channelId} />
            </Suspense>
          )}

          {/* Price chart */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">
              Price History
            </h2>
            {chartData.length > 0 ? (
              <PriceChart data={chartData} />
            ) : (
              <div className="h-48 flex items-center justify-center text-muted text-sm">
                No trades yet — chart will appear after the first trade
              </div>
            )}
          </div>

          {/* Market info */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">
              Market Details
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted">Type</div>
                <div className="font-medium capitalize">
                  {market.questionType} milestone
                </div>
              </div>
              <div>
                <div className="text-muted">Target</div>
                <div className="font-medium">
                  {Number(market.milestoneThreshold).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted">Liquidity (b)</div>
                <div className="font-medium">{market.bParameter}</div>
              </div>
              <div>
                <div className="text-muted">Resolves</div>
                <div className="font-medium">
                  {market.resolvesAt
                    ? new Date(market.resolvesAt).toLocaleDateString()
                    : "TBD"}
                </div>
              </div>
            </div>
            {market.description && (
              <p className="text-sm text-muted mt-3">{market.description}</p>
            )}
          </div>

          {/* Recent trades */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-muted mb-3">
              Recent Trades
            </h2>
            {recentTrades.length > 0 ? (
              <div className="space-y-2">
                {recentTrades.map((trade) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          parseFloat(trade.shares) > 0
                            ? "bg-green/10 text-green"
                            : "bg-red/10 text-red"
                        }`}
                      >
                        {parseFloat(trade.shares) > 0 ? "BUY" : "SELL"}
                      </span>
                      <span className="font-medium">
                        {trade.outcome === 1 ? "YES" : "NO"}
                      </span>
                      <span className="text-muted">
                        {Math.abs(parseFloat(trade.shares)).toFixed(1)} shares
                      </span>
                    </div>
                    <div className="text-muted">
                      {Math.abs(parseFloat(trade.cost)).toFixed(2)} coins
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted text-sm py-4">
                No trades yet
              </div>
            )}
          </div>
        </div>

        {/* Right column: trading panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            {/* Current odds */}
            <div className="bg-card border border-border rounded-xl p-4 mb-4">
              <h2 className="text-sm font-medium text-muted mb-3">
                Current Odds
              </h2>
              <div className="flex gap-3">
                <div className="flex-1 text-center p-3 bg-green/10 rounded-lg">
                  <div className="text-2xl font-bold text-green">
                    {(prices[0] * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted mt-1">YES</div>
                </div>
                <div className="flex-1 text-center p-3 bg-red/10 rounded-lg">
                  <div className="text-2xl font-bold text-red">
                    {(prices[1] * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted mt-1">NO</div>
                </div>
              </div>
            </div>

            {/* Trade panel */}
            {session?.user && market.status === "active" ? (
              <TradePanel marketId={market.id} prices={prices} />
            ) : market.status === "resolved" ? (
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <div className="text-lg font-bold mb-1">
                  Resolved:{" "}
                  <span
                    className={
                      market.outcome === 1 ? "text-green" : "text-red"
                    }
                  >
                    {market.outcome === 1 ? "YES" : "NO"}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  This market has been resolved and payouts distributed.
                </p>
              </div>
            ) : !session?.user ? (
              <div className="bg-card border border-border rounded-xl p-4 text-center">
                <p className="text-sm text-muted mb-3">
                  Sign in to start trading
                </p>
                <a
                  href="/auth/signin"
                  className="inline-block px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Sign In
                </a>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-4 text-center text-sm text-muted">
                Trading is not available for this market.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
