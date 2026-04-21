import { db } from "@/db";
import { markets, trades, priceSnapshots, youtubePolls, tiktokPolls } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { allPrices } from "@/lib/lmsr";
import { MarketLiveData } from "@/components/MarketLiveData";
import { VideoDescription } from "@/components/VideoDescription";
import { ChannelHistorySection } from "@/components/ChannelHistorySection";
import { TikTokEmbed } from "@/components/TikTokEmbed";
import type { MarketData } from "@/types/market";
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
    market.platform === "tiktok"
      ? db
          .select()
          .from(tiktokPolls)
          .where(eq(tiktokPolls.marketId, id))
          .orderBy(tiktokPolls.polledAt)
          .limit(500)
      : db
          .select()
          .from(youtubePolls)
          .where(eq(youtubePolls.marketId, id))
          .orderBy(youtubePolls.polledAt)
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
    platform: market.platform,
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
      {/* Static: video embed */}
      {market.platform === "tiktok" ? (
        <div className="flex justify-center mb-6">
          <div className="w-[325px]">
            <TikTokEmbed videoId={market.videoId} title={videoMetadata?.title || market.title} />
          </div>
        </div>
      ) : (
        <div className="aspect-video bg-card rounded-xl overflow-hidden border border-border mb-6">
          <iframe
            src={`https://www.youtube.com/embed/${market.videoId}`}
            title={videoMetadata?.title || market.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* Static: description */}
      {videoMetadata?.description && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6">
          <h2 className="text-sm font-medium text-muted mb-3">
            About This Video
          </h2>
          <VideoDescription description={videoMetadata.description} />
        </div>
      )}

      {/* Dynamic: everything else, with server-rendered channel history as children */}
      <MarketLiveData marketId={id} session={session} initialData={initialData}>
        {market.platform !== "tiktok" && videoMetadata?.channelId && (
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
      </MarketLiveData>
    </div>
  );
}
