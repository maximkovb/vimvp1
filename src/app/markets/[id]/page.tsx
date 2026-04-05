import { db } from "@/db";
import { markets, trades, priceSnapshots, tiktokPolls } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { allPrices } from "@/lib/lmsr";
import { MarketLiveData } from "@/components/MarketLiveData";
import { MarketHUD } from "@/components/MarketHUD";
import { LiveEngagementStats } from "@/components/LiveEngagementStats";
import { VideoDescription } from "@/components/VideoDescription";
import { TikTokEmbed } from "@/components/TikTokEmbed";
import type { MarketData } from "@/types/market";

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
  const [priceYes, priceNo] = allPrices(quantities, b);

  const [recentTrades, history, pollHistory] = await Promise.all([
    db
      .select()
      .from(trades)
      .where(eq(trades.marketId, id))
      .orderBy(desc(trades.createdAt))
      .limit(20),
    db
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.marketId, id))
      .orderBy(priceSnapshots.recordedAt)
      .limit(500),
    db
      .select()
      .from(tiktokPolls)
      .where(eq(tiktokPolls.marketId, id))
      .orderBy(tiktokPolls.polledAt)
      .limit(500),
  ]);

  const initialData: MarketData = {
    id: market.id,
    title: market.title,
    description: market.description,
    status: market.status,
    questionType: market.questionType,
    milestoneThreshold: market.milestoneThreshold.toString(),
    videoId: market.videoId,
    tikapiPostId: market.tikapiPostId,
    videoMetadata: market.videoMetadata ?? null,
    priceYes,
    priceNo,
    outcome: market.outcome,
    resolvesAt: market.resolvesAt?.toISOString() ?? null,
    resolvedAt: market.resolvedAt?.toISOString() ?? null,
    priceHistory: history.map((s) => ({
      time: s.recordedAt.toISOString(),
      priceYes: parseFloat(s.priceYes),
      priceNo: parseFloat(s.priceNo),
      volumeTotal: parseFloat(s.volumeTotal),
    })),
    recentTrades: recentTrades.map((t) => ({
      id: t.id,
      outcome: t.outcome,
      shares: parseFloat(t.shares),
      cost: parseFloat(t.cost),
      priceBefore: parseFloat(t.priceBefore),
      priceAfter: parseFloat(t.priceAfter),
      createdAt: t.createdAt.toISOString(),
    })),
    pollHistory: pollHistory.map((p) => ({
      time: p.polledAt.toISOString(),
      viewCount: p.viewCount !== null ? Number(p.viewCount) : null,
      likeCount: p.likeCount !== null ? Number(p.likeCount) : null,
    })),
  };

  const videoMetadata = market.videoMetadata;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Page title */}
      <h1 className="text-2xl font-bold mb-6">{market.title}</h1>

      {/* Main two-column section: video left + HUD right */}
      <div className="flex flex-col lg:flex-row gap-6 items-start mb-8">
        {/* Left column: TikTok video + creator card + description */}
        <div className="w-full lg:w-[360px] flex-shrink-0 space-y-4">
          <TikTokEmbed
            videoId={market.videoId}
            title={videoMetadata?.title || market.title}
            playUrl={videoMetadata?.playUrl}
            thumbnail={videoMetadata?.thumbnail}
            creatorId={videoMetadata?.creatorId}
          />

          {/* Creator card */}
          {videoMetadata && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-accent text-sm font-bold">
                    {videoMetadata.channelTitle?.charAt(0)?.toUpperCase() ?? "?"}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {videoMetadata.channelTitle}
                  </div>
                  <div className="text-xs text-muted">TikTok Creator</div>
                </div>
              </div>

              {/* Engagement stats — live via SWR */}
              <LiveEngagementStats marketId={id} initialData={initialData} />
            </div>
          )}

          {/* Video description */}
          {videoMetadata?.description && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-sm font-medium text-muted mb-3">
                About This Video
              </h2>
              <VideoDescription description={videoMetadata.description} />
            </div>
          )}
        </div>

        {/* Right column: sticky HUD */}
        <div className="w-full lg:flex-1 lg:max-w-[400px] lg:sticky lg:top-4">
          <MarketHUD marketId={id} session={session} initialData={initialData} />
        </div>
      </div>

      {/* Full-width stats section */}
      <MarketLiveData marketId={id} initialData={initialData} />
    </div>
  );
}
