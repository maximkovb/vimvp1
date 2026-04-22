import Link from "next/link";
import { CountdownTimer } from "@/components/CountdownTimer";

interface ResolvingRailCardProps {
  id: string;
  title: string;
  priceYes: number;
  priceNo: number;
  resolvesAt: Date;
}

/**
 * Card displayed in the "Resolving Soon" rail on the home feed.
 * Server-rendered — no client SWR needed.
 */
export function ResolvingRailCard({
  id,
  title,
  priceYes,
  priceNo,
  resolvesAt,
}: ResolvingRailCardProps) {
  return (
    <Link
      href={`/markets/${id}`}
      className="block bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 hover:border-amber-500/60 transition-colors group"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <CountdownTimer target={resolvesAt} variant="urgent" />
      </div>

      <h3 className="font-semibold text-sm leading-snug mb-3 line-clamp-2 group-hover:text-amber-500 transition-colors">
        {title}
      </h3>

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
    </Link>
  );
}
