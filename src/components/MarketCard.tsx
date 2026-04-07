import Image from "next/image";
import Link from "next/link";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { formatOutcome } from "@/lib/format";
import { MarketStatusBadge } from "./MarketStatusBadge";
import { CountdownTimer } from "./CountdownTimer";
import type { MarketStatus, QuestionType } from "@/db/schema";

interface MarketCardProps {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  priceYes: number;
  priceNo: number;
  resolvesAt: Date | null;
  outcome: number | null;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
  } | null;
}

export function MarketCard({
  id,
  title,
  status,
  questionType,
  milestoneThreshold,
  priceYes,
  priceNo,
  resolvesAt,
  outcome,
  videoMetadata,
}: MarketCardProps) {
  return (
    <Link
      href={`/markets/${id}`}
      className="block bg-card border border-border rounded-xl overflow-hidden hover:border-accent/50 transition-colors group"
    >
      {/* Thumbnail — only render TikTok CDN URLs; legacy YouTube thumbnails are skipped */}
      {videoMetadata?.thumbnail && TIKTOK_THUMBNAIL_RE.test(videoMetadata.thumbnail) && (
        <div className="relative aspect-video bg-background overflow-hidden">
          <Image
            src={videoMetadata.thumbnail}
            alt={videoMetadata.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}

      <div className="p-4">
        {/* Status + countdown */}
        <div className="flex items-center justify-between mb-2">
          <MarketStatusBadge
            status={status}
            pulsing={status === "halted" || status === "resolving"}
          />
          {resolvesAt && status !== "resolved" && status !== "cancelled" && (
            <CountdownTimer
              target={resolvesAt}
              variant={status === "halted" || status === "resolving" ? "urgent" : "default"}
            />
          )}
          {status === "resolved" && (
            <span
              className={`text-xs font-bold ${
                outcome === 0 ? "text-green" : "text-red"
              }`}
            >
              {outcome !== null ? formatOutcome(outcome) : null}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-sm leading-snug mb-2 line-clamp-2">
          {title}
        </h3>

        {/* Channel + target */}
        <div className="flex items-center justify-between text-xs text-muted mb-3">
          <span>{videoMetadata?.channelTitle}</span>
          <span className="capitalize">
            {milestoneThreshold.toLocaleString()} {questionType}
          </span>
        </div>

        {/* Odds bar */}
        <div className="flex gap-2">
          <div
            className="flex-1 text-center py-1.5 rounded-lg text-xs font-bold bg-green/10 text-green"
            style={{ flex: priceYes }}
          >
            YES {(priceYes * 100).toFixed(0)}%
          </div>
          <div
            className="flex-1 text-center py-1.5 rounded-lg text-xs font-bold bg-red/10 text-red"
            style={{ flex: priceNo }}
          >
            NO {(priceNo * 100).toFixed(0)}%
          </div>
        </div>
      </div>
    </Link>
  );
}
