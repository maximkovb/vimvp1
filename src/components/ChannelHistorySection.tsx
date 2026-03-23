import { fetchChannelRecentVideos } from "@/lib/youtube";
import { ChannelHistoryCards } from "@/components/ChannelHistoryCards";

interface ChannelHistorySectionProps {
  channelId: string;
}

export async function ChannelHistorySection({
  channelId,
}: ChannelHistorySectionProps) {
  const videos = await fetchChannelRecentVideos(channelId);
  if (videos.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-medium text-muted mb-3">Channel History</h2>
      <ChannelHistoryCards videos={videos} />
    </div>
  );
}
