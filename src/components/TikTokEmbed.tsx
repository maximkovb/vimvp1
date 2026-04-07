"use client";

import Image from "next/image";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import { VideoControls } from "./VideoControls";

interface TikTokEmbedProps {
  videoId: string;
  title?: string;
  thumbnail?: string | null;
  creatorId?: string | null;
  showLink?: boolean;
  isActive?: boolean;
}

export function TikTokEmbed({
  videoId,
  title,
  thumbnail,
  showLink = true,
  isActive = false,
}: TikTokEmbedProps) {
  const {
    streamSrc,
    loadError,
    isMuted,
    isPaused,
    currentTime,
    duration,
    videoRef,
    toggleMute,
    togglePause,
    handleSeek,
    videoEvents,
  } = useVideoPlayer(videoId, isActive);

  return (
    <div className="flex flex-col gap-2">
      {/* 9:16 aspect ratio wrapper */}
      <div
        className="relative w-full rounded-xl overflow-hidden"
        style={{ paddingBottom: "177.78%" }}
      >
        {loadError ? (
          thumbnail ? (
            <Image
              src={thumbnail}
              alt={title ?? "TikTok video"}
              fill
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-card to-background" />
          )
        ) : (
          <>
            <video
              ref={videoRef}
              src={streamSrc}
              poster={thumbnail ?? undefined}
              loop
              playsInline
              title={title ?? "TikTok video"}
              className="absolute inset-0 w-full h-full object-cover cursor-pointer"
              onClick={togglePause}
              {...videoEvents}
            />

            {/* Controls overlay */}
            <div
              className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5 pt-6"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)",
              }}
            >
              <VideoControls
                isPaused={isPaused}
                isMuted={isMuted}
                currentTime={currentTime}
                duration={duration}
                onTogglePause={togglePause}
                onToggleMute={toggleMute}
                onSeek={handleSeek}
              />
            </div>
          </>
        )}
      </div>

      {showLink && (
        <a
          href={`https://www.tiktok.com/video/${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-accent hover:underline self-end"
        >
          View on TikTok ↗
        </a>
      )}
    </div>
  );
}
