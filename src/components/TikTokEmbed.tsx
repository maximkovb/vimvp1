"use client";

import { useRef, useState } from "react";

interface TikTokEmbedProps {
  videoId: string;
  title?: string;
  playUrl?: string | null;
  thumbnail?: string | null;
}

function MutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function TikTokEmbed({ videoId, title, playUrl, thumbnail }: TikTokEmbedProps) {
  const [currentPlayUrl, setCurrentPlayUrl] = useState(playUrl ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  async function handleVideoError() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/tiktok/${videoId}/play-url`);
      if (res.ok) {
        const data = await res.json();
        setCurrentPlayUrl(data.playUrl ?? null);
      } else {
        setCurrentPlayUrl(null);
      }
    } catch {
      setCurrentPlayUrl(null);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleMute() {
    if (!videoRef.current) return;
    const next = !isMuted;
    videoRef.current.muted = next;
    setIsMuted(next);
  }

  function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 9:16 aspect ratio wrapper */}
      <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
        {currentPlayUrl ? (
          <>
            <video
              ref={videoRef}
              key={currentPlayUrl}
              src={currentPlayUrl}
              poster={thumbnail ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              title={title ?? "TikTok video"}
              className="absolute inset-0 w-full h-full object-cover rounded-xl cursor-pointer"
              onError={handleVideoError}
              onClick={togglePause}
              onPause={() => setIsPaused(true)}
              onPlay={() => setIsPaused(false)}
            />

            {/* Pause indicator */}
            {isPaused && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-xl"
                aria-hidden="true"
              >
                <div className="rounded-full bg-black/50 p-3">
                  <PlayIcon />
                </div>
              </div>
            )}

            {/* Mute toggle */}
            <button
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="absolute bottom-3 right-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
          </>
        ) : (
          <iframe
            src={`https://www.tiktok.com/embed/v2/${videoId}`}
            title={title ?? "TikTok video"}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        )}
      </div>

      {/* Link to original video */}
      <a
        href={`https://vm.tiktok.com/${videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted hover:text-accent hover:underline self-end"
      >
        View on TikTok ↗
      </a>
    </div>
  );
}
