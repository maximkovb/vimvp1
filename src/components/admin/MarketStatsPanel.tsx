import { formatCount } from "@/lib/format";

interface MarketStatsPanelProps {
  viewCount: number;
  likeCount: number;
  videoAgeHours: number;
  /** Subscriber count — null while Phase 2 is loading */
  subscriberCount: number | null;
  /** Channel avg views per Short — null while Phase 2 is loading */
  channelAvgViews: number | null;
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function SkeletonCell({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
      <div className="h-5 w-20 bg-border/50 rounded animate-pulse" />
    </div>
  );
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m old`;
  if (hours < 24) return `${hours.toFixed(1)}h old`;
  return `${(hours / 24).toFixed(1)}d old`;
}

export function MarketStatsPanel({
  viewCount,
  likeCount,
  videoAgeHours,
  subscriberCount,
  channelAvgViews,
}: MarketStatsPanelProps) {
  return (
    <div className="p-4 bg-card border border-border rounded-lg">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
        Video Stats
      </h3>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <StatCell label="Views" value={formatCount(viewCount)} />
        <StatCell label="Likes" value={formatCount(likeCount)} />
        <StatCell label="Age" value={formatAge(videoAgeHours)} />
        {subscriberCount !== null ? (
          <StatCell label="Subscribers" value={formatCount(subscriberCount)} />
        ) : (
          <SkeletonCell label="Subscribers" />
        )}
        {channelAvgViews !== null ? (
          <StatCell label="Channel avg / Short" value={formatCount(Math.round(channelAvgViews))} />
        ) : (
          <SkeletonCell label="Channel avg / Short" />
        )}
      </div>
    </div>
  );
}
