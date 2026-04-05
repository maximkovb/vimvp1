"use client";

import useSWR from "swr";
import type { MarketData } from "@/types/market";
import { formatCount } from "@/lib/format";
import { marketFetcher } from "@/lib/market-fetcher";

interface LiveEngagementStatsProps {
  marketId: string;
  initialData: MarketData;
}

export function LiveEngagementStats({ marketId, initialData }: LiveEngagementStatsProps) {
  const { data } = useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    { refreshInterval: 60_000, fallbackData: initialData }
  );

  const market = data ?? initialData;
  // Find the last poll row that actually has data — guards against stale null rows.
  const latestPollWithViews = [...market.pollHistory].reverse().find((p) => p.viewCount != null);
  const latestPollWithLikes = [...market.pollHistory].reverse().find((p) => p.likeCount != null);
  const latestViews = latestPollWithViews?.viewCount ?? null;
  const latestLikes = latestPollWithLikes?.likeCount ?? null;

  if (latestViews === null && latestLikes === null) return null;

  return (
    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
      {latestViews !== null && (
        <div>
          <div className="text-xs text-muted">Views</div>
          <div className="text-sm font-semibold">{formatCount(latestViews)}</div>
        </div>
      )}
      {latestLikes !== null && (
        <div>
          <div className="text-xs text-muted">Likes</div>
          <div className="text-sm font-semibold">{formatCount(latestLikes)}</div>
        </div>
      )}
    </div>
  );
}
