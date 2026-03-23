import type { ChannelVideo } from "@/lib/youtube";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface ChannelHistoryCardsProps {
  videos: ChannelVideo[];
}

export function ChannelHistoryCards({ videos }: ChannelHistoryCardsProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {videos.map((video) => (
        <div
          key={video.id}
          className="flex-shrink-0 w-48 rounded-lg border border-border bg-background overflow-hidden"
        >
          {video.thumbnail ? (
            <img
              src={video.thumbnail}
              alt={video.title}
              className="w-full aspect-video object-cover"
            />
          ) : (
            <div className="w-full aspect-video bg-card" />
          )}
          <div className="p-2">
            <p className="text-xs font-medium line-clamp-2 leading-snug mb-1">
              {video.title}
            </p>
            <p className="text-xs text-muted">
              {formatCount(video.viewCount)} views · {formatCount(video.likeCount)} likes
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
