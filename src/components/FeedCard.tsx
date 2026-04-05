"use client";

import Image from "next/image";
import { useState, useRef } from "react";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { TikTokEmbed } from "./TikTokEmbed";
import { TradePanel } from "./TradePanel";
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
  currentCount: bigint | null; // latest viewCount or likeCount from tiktokPolls
  isTrending: boolean;
  priority?: boolean;
  onTap: (initialOutcome?: number) => void;
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
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
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
  onTap,
}: FeedCardProps) {
  const [currentPlayUrl, setCurrentPlayUrl] = useState(videoMetadata?.playUrl ?? null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const thumbnailSrc =
    videoMetadata?.thumbnail && TIKTOK_THUMBNAIL_RE.test(videoMetadata.thumbnail)
      ? videoMetadata.thumbnail
      : null;
  const isTrading = status === "active";

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
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* ── DESKTOP LAYOUT (≥1024px) ─────────────────────────────────────── */}
      <div className="hidden lg:flex flex-row h-full items-center justify-center gap-8 px-12">
        {/* Left: 9:16 video via TikTokEmbed */}
        <div className="w-[325px] flex-shrink-0">
          <TikTokEmbed
            videoId={videoId}
            title={title}
            playUrl={videoMetadata?.playUrl}
            thumbnail={thumbnailSrc}
            creatorId={videoMetadata?.creatorId}
            showLink={false}
          />
        </div>

        {/* Right: side HUD */}
        <div className="flex flex-col gap-5 w-[360px] flex-shrink-0 overflow-y-auto max-h-screen py-8">
          {/* Status badge */}
          {(status === "halted" || status === "resolving") ? (
            <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
              {status === "resolving" ? "Resolving" : "Halted"}
            </span>
          ) : isTrending ? (
            <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/40 uppercase tracking-wide">
              Trending
            </span>
          ) : null}

          {/* Creator + title */}
          <div>
            <p className="text-sm text-muted">
              @{videoMetadata?.channelTitle ?? "Unknown"}
            </p>
            <p className="font-semibold leading-snug mt-1">{title}</p>
          </div>

          {/* Progress ring + milestone */}
          <div className="flex items-center gap-3">
            <ProgressRing current={currentCount} target={milestoneThreshold} />
            <p className="text-xs text-muted">
              Target:{" "}
              {Number(milestoneThreshold).toLocaleString()} {questionType}
            </p>
          </div>

          {/* Trade panel or halted badge */}
          {isTrading ? (
            <TradePanel
              marketId={id}
              prices={[priceYes, priceNo]}
            />
          ) : (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm text-center">
              {status === "resolving" ? "Resolving…" : "Trading halted"}
            </div>
          )}
        </div>
      </div>

      {/* ── MOBILE LAYOUT (<1024px) ──────────────────────────────────────── */}
      <div className="lg:hidden relative w-full h-full cursor-pointer" onClick={() => isTrading && onTap()}>
        {/* Full-bleed video */}
        {currentPlayUrl ? (
          <>
            <video
              ref={videoRef}
              key={currentPlayUrl}
              src={currentPlayUrl}
              poster={thumbnailSrc ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              onClick={(e) => { e.stopPropagation(); togglePause(); }}
              onError={handleVideoError}
              onPause={() => setIsPaused(true)}
              onPlay={() => setIsPaused(false)}
            />

            {/* Pause indicator */}
            {isPaused && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                <div className="rounded-full bg-black/50 p-3">
                  <PlayIcon />
                </div>
              </div>
            )}

            {/* Mute toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="absolute bottom-32 right-4 z-20 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
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
          <p className="text-sm text-white/60 mb-1">
            @{videoMetadata?.channelTitle ?? "Unknown"}
          </p>
          <p className="text-white text-sm leading-snug mb-4 line-clamp-2">{title}</p>
          <p className="text-xs text-white/40 mb-3">
            Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
          </p>

          {/* YES / NO buttons */}
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
    </div>
  );
}
