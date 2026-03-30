interface TikTokEmbedProps {
  videoId: string;
  title?: string;
}

export function TikTokEmbed({ videoId, title }: TikTokEmbedProps) {
  return (
    // 9:16 aspect ratio wrapper
    <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
      <iframe
        src={`https://www.tiktok.com/embed/v2/${videoId}`}
        title={title ?? "TikTok video"}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}
