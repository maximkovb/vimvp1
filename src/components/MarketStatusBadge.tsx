import type { MarketStatus } from "@/db/schema";

const statusConfig: Record<
  MarketStatus,
  { label: string; className: string }
> = {
  draft: { label: "Draft", className: "bg-muted/20 text-muted" },
  active: { label: "Active", className: "bg-green/10 text-green" },
  halted: { label: "Trading Halted", className: "bg-yellow-500/10 text-yellow-500" },
  resolving: { label: "Resolving", className: "bg-accent/10 text-accent" },
  resolved: { label: "Resolved", className: "bg-muted/20 text-muted" },
  cancelled: { label: "Cancelled", className: "bg-red/10 text-red" },
  failed: { label: "Failed", className: "bg-red/10 text-red" },
};

export function MarketStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as MarketStatus] || statusConfig.draft;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
