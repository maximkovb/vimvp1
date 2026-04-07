export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format an outcome integer as a label. 0=YES, 1=NO per schema.ts convention. */
export function formatOutcome(outcome: number): "YES" | "NO" {
  return outcome === 0 ? "YES" : "NO";
}
