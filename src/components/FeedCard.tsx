"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { TikTokEmbed } from "./TikTokEmbed";
import { TradePanel } from "./TradePanel";
import { VideoControls } from "./VideoControls";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import type { MarketStatus, QuestionType } from "@/db/schema";

interface FeedCardProps {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  priceYes: number;
  priceNo: number;
  videoId: string;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
    playUrl?: string | null;
    creatorId?: string | null;
  } | null;
  currentCount: bigint | null;
  isTrending: boolean;
  priority?: boolean;
  isActive: boolean;
  onTap: (initialOutcome?: number) => void;
}

/** Returns true/false after hydration; null during SSR and initial paint. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

function ProgressRing({
  current,
  target,
}: {
  current: bigint | null;
  target: bigint;
}) {
  const size = 56;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const targetNum = Number(target);
  const currentNum = current !== null ? Number(current) : null;

  const pct =
    currentNum !== null && targetNum > 0
      ? Math.min(currentNum / targetNum, 1)
      : 0;
  const offset = circumference * (1 - pct);

  const formatCount = (n: number | null) => {
    if (n === null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  const formatTarget = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  };

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="relative z-10 text-center leading-tight">
        <div className="text-[10px] font-bold text-foreground tabular-nums">
          {formatCount(currentNum)}
        </div>
        <div className="text-[8px] text-muted">/{formatTarget(targetNum)}</div>
      </div>
    </div>
  );
}

function BigPlayIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function FeedCard({
  id,
  title,
  status,
  questionType,
  milestoneThreshold,
  priceYes,
  priceNo,
  videoId,
  videoMetadata,
  currentCount,
  isTrending,
  priority = false,
  isActive,
  onTap,
}: FeedCardProps) {
  const isDesktop = useIsDesktop();
  const isTrading = status === "active";

  const thumbnailSrc =
    videoMetadata?.thumbnail && TIKTOK_THUMBNAIL_RE.test(videoMetadata.thumbnail)
      ? videoMetadata.thumbnail
      : null;

  // Video state for mobile layout
  const {
    streamSrc,
    hasActivated,
    loadError,
    isMuted,
    isPaused,
    currentTime,
    duration,
    setVideoRef,
    toggleMute,
    togglePause,
    handleSeek,
    videoEvents,
  } = useVideoPlayer(videoId, isActive);

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* ── DESKTOP LAYOUT ───────────────────────────────────────────────── */}
      {isDesktop === true && (
        <div className="flex flex-row h-full items-center justify-center gap-8 px-12">
          {/* Left: 9:16 video */}
          <div className="w-[325px] flex-shrink-0">
            <TikTokEmbed
              videoId={videoId}
              title={title}
              thumbnail={thumbnailSrc}
              creatorId={videoMetadata?.creatorId}
              showLink={false}
              isActive={isActive}
            />
          </div>

          {/* Right: side HUD */}
          <div className="flex flex-col gap-5 w-[360px] flex-shrink-0 overflow-y-auto max-h-screen py-8">
            {(status === "halted" || status === "resolving") ? (
              <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
                {status === "resolving" ? "Resolving" : "Halted"}
              </span>
            ) : isTrending ? (
              <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/40 uppercase tracking-wide">
                Trending
              </span>
            ) : null}

            <div>
              <p className="text-sm text-muted">
                @{videoMetadata?.channelTitle ?? "Unknown"}
              </p>
              <p className="font-semibold leading-snug mt-1">{title}</p>
            </div>

            <div className="flex items-center gap-3">
              <ProgressRing current={currentCount} target={milestoneThreshold} />
              <p className="text-xs text-muted">
                Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
              </p>
            </div>

            {isTrading ? (
              <TradePanel marketId={id} prices={[priceYes, priceNo]} />
            ) : (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm text-center">
                {status === "resolving" ? "Resolving…" : "Trading halted"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MOBILE LAYOUT (also shown during SSR / initial paint before isDesktop resolves) */}
      {isDesktop !== true && (
        <div
          className="relative w-full h-full cursor-pointer"
          onClick={() => isTrading && onTap()}
        >
          {/* Full-bleed video — only mounted after first activation to prevent
              concurrent stream requests on initial load. Falls back to thumbnail
              before activation or on load error. */}
          {hasActivated && !loadError ? (
            <>
              <video
                ref={setVideoRef}
                src={streamSrc}
                poster={thumbnailSrc ?? undefined}
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
                onClick={(e) => { e.stopPropagation(); togglePause(); }}
                {...videoEvents}
              />

              {isPaused && (
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  aria-hidden="true"
                >
                  <div className="rounded-full bg-black/50 p-3">
                    <BigPlayIcon />
                  </div>
                </div>
              )}
            </>
          ) : thumbnailSrc ? (
            <Image
              src={thumbnailSrc}
              alt={title}
              fill
              className="object-cover"
              priority={priority}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-card to-background" />
          )}

          {/* Gradient overlays */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(to top, rgba(10,10,19,0.95) 0%, rgba(10,10,19,0.3) 40%, transparent 60%), linear-gradient(to bottom, rgba(10,10,19,0.6) 0%, transparent 25%)",
            }}
          />

          {/* Top-left badge */}
          <div className="absolute top-4 left-4 z-10">
            {(status === "halted" || status === "resolving") ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
                {status === "resolving" ? "Resolving" : "Halted"}
              </span>
            ) : isTrending ? (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/40 uppercase tracking-wide">
                Trending
              </span>
            ) : null}
          </div>

          {/* Top-right progress ring */}
          <div className="absolute top-4 right-4 z-10">
            <ProgressRing current={currentCount} target={milestoneThreshold} />
          </div>

          {/* Bottom content */}
          <div className="absolute bottom-0 left-0 right-0 z-10 p-5">
            {/* Video controls — only shown once video has mounted and not errored */}
            {hasActivated && !loadError && (
              <div className="mb-3">
                <VideoControls
                  isPaused={isPaused}
                  isMuted={isMuted}
                  currentTime={currentTime}
                  duration={duration}
                  onTogglePause={togglePause}
                  onToggleMute={toggleMute}
                  onSeek={handleSeek}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            <p className="text-sm text-white/60 mb-1">
              @{videoMetadata?.channelTitle ?? "Unknown"}
            </p>
            <p className="text-white text-sm leading-snug mb-4 line-clamp-2">{title}</p>
            <p className="text-xs text-white/40 mb-3">
              Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
            </p>

            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isTrading) onTap(0);
                }}
                disabled={!isTrading}
                className={`flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide transition-opacity ${
                  isTrading
                    ? "bg-green text-white hover:opacity-90 active:opacity-75"
                    : "bg-green/20 text-green/40 cursor-not-allowed"
                }`}
              >
                YES&nbsp;{(priceYes * 100).toFixed(0)}%
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isTrading) onTap(1);
                }}
                disabled={!isTrading}
                className={`flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide transition-opacity ${
                  isTrading
                    ? "bg-red text-white hover:opacity-90 active:opacity-75"
                    : "bg-red/20 text-red/40 cursor-not-allowed"
                }`}
              >
                NO&nbsp;{(priceNo * 100).toFixed(0)}%
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
