"use client";

import Image from "next/image";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import type { MarketStatus, QuestionType } from "@/db/schema";

interface FeedCardProps {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  priceYes: number;
  priceNo: number;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
  } | null;
  currentCount: bigint | null; // latest viewCount or likeCount from tiktokPolls
  isTrending: boolean;
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

  const pct =
    current !== null && target > 0n
      ? Math.min(Number((current * 1000n) / target) / 1000, 1)
      : 0;
  const offset = circumference * (1 - pct);

  const formatCount = (n: bigint | null) => {
    if (n === null) return "—";
    const num = Number(n);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
    return num.toString();
  };

  const formatTarget = (n: bigint) => {
    const num = Number(n);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(0)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
    return num.toString();
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
          {formatCount(current)}
        </div>
        <div className="text-[8px] text-muted">/{formatTarget(target)}</div>
      </div>
    </div>
  );
}

export function FeedCard({
  title,
  status,
  questionType,
  milestoneThreshold,
  priceYes,
  priceNo,
  videoMetadata,
  currentCount,
  isTrending,
  onTap,
}: FeedCardProps) {
  const hasThumbnail =
    videoMetadata?.thumbnail && TIKTOK_THUMBNAIL_RE.test(videoMetadata.thumbnail);
  const isTrading = status === "active";
  const isHalted = status === "halted" || status === "resolving";

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-background cursor-pointer"
      onClick={() => isTrading && onTap()}
    >
      {/* Thumbnail background */}
      {hasThumbnail ? (
        <Image
          src={videoMetadata!.thumbnail}
          alt={title}
          fill
          className="object-cover"
          priority
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
        {isHalted ? (
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
        {/* Creator + caption */}
        <p className="text-sm text-white/60 mb-1">
          @{videoMetadata?.channelTitle ?? "Unknown"}
        </p>
        <p className="text-white text-sm leading-snug mb-4 line-clamp-2">{title}</p>

        {/* Milestone label */}
        <p className="text-xs text-white/40 mb-3">
          Target: {Number(milestoneThreshold).toLocaleString()} {questionType}s
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
  );
}
