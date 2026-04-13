"use client";

import { useState } from "react";
import useSWR from "swr";
import { formatCount } from "@/lib/format";
import type { CreatorBaselineData } from "@/app/api/tiktok/creator-baseline/route";

interface CreatorBaselineCardProps {
  creatorId: string; // videoMetadata.creatorId (may be empty string)
  videoId: string;   // market.tikapiPostId ?? market.videoId
}

// Module-scope stable fetcher — must NOT be defined inside the component body.
// Returns null on 422 (insufficient_data); throws on other non-OK responses.
async function baselineFetcher(url: string): Promise<CreatorBaselineData | null> {
  const res = await fetch(url);
  if (res.status === 422) return null;
  if (!res.ok) throw new Error(`Baseline fetch failed: ${res.status}`);
  return res.json() as Promise<CreatorBaselineData>;
}

const VERDICT_CONFIG = {
  ahead:    { icon: "▲", label: "Ahead of pace",  colorClass: "text-green-500" },
  on_pace:  { icon: "—", label: "On pace",         colorClass: "text-amber-400" },
  behind:   { icon: "▼", label: "Behind pace",     colorClass: "text-red-500" },
} as const;

export function CreatorBaselineCard({ creatorId, videoId }: CreatorBaselineCardProps) {
  const [open, setOpen] = useState(false);

  // If creatorId is empty, pass null as key to disable fetch entirely.
  const key = creatorId
    ? `/api/tiktok/creator-baseline?creatorId=${encodeURIComponent(creatorId)}&videoId=${encodeURIComponent(videoId)}`
    : null;

  const { data, isLoading, error } = useSWR<CreatorBaselineData | null>(
    key,
    baselineFetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
      dedupingInterval: 300_000, // 5-minute client-side cache per creatorId
    }
  );

  // "not enough data" state: no creatorId, 422 response (data === null), or network/server error
  const hasData = !isLoading && !error && data !== null && data !== undefined;

  const renderHeader = () => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted">Creator Baseline</span>
          <div className="h-4 w-28 rounded bg-muted/30 animate-pulse" />
        </div>
      );
    }

    if (!hasData) {
      return (
        <span className="text-sm font-medium text-muted">Creator Baseline</span>
      );
    }

    const { verdict, deltaPercent } = data!;
    const { icon, label, colorClass } = VERDICT_CONFIG[verdict];
    const sign = deltaPercent >= 0 ? "+" : "";

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-muted">Creator Baseline</span>
        <span className={`text-sm font-semibold ${colorClass}`}>
          {icon} {label} {sign}{deltaPercent}%
        </span>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {renderHeader()}
        <span className="text-muted text-xs ml-2 flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          {!hasData ? (
            <p className="text-sm text-muted pt-3">
              Not enough data yet. Check back as more videos are published.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 pt-3">
                <div>
                  <div className="text-xs text-muted">This video</div>
                  <div className="text-sm font-semibold">
                    {formatCount(data!.videoViewsPerHr)}/hr
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted">Creator avg</div>
                  <div className="text-sm font-semibold">
                    {formatCount(data!.creatorMedianViewsPerHr)}/hr
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted">
                Based on {data!.baselineVideoCount} recent videos
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
