/** Only accept TikTok CDN thumbnail URLs in DB writes and API responses. */
export const TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//;

/**
 * Only accept known CDN play URL domains in DB writes and API responses.
 * TikWM returns direct MP4 URLs from TikTok's own CDN (*.tiktok.com, *.tiktokv.com,
 * *.tiktokcdn.com) and occasionally from its own CDN (*.tikwm.com).
 *
 * IMPORTANT: This regex must stay in sync with the CSP `media-src` directive in
 * `next.config.ts`. Update both together whenever a new CDN domain is added.
 * Applied at: poll-tiktok/route.ts, admin.ts, /api/tiktok/[videoId]/play-url/route.ts
 */
export const TIKTOK_PLAY_URL_RE =
  /^https:\/\/[a-z0-9-]+\.(tiktok\.com|tiktokv\.com|tiktokcdn(?:-us)?\.com|tikwm\.com)\//;

/** TikTok video IDs are 15–20 digit numeric strings. */
export const TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/;

/**
 * TikTok username handles: letters, digits, underscores, periods, 1–24 chars.
 * Applied to the creatorId param before inclusion in any outbound URL (SSRF guard).
 */
export const TIKTOK_CREATOR_ID_RE = /^[a-zA-Z0-9._]{1,24}$/;

// ---------------------------------------------------------------------------
// Outcome encoding — single source of truth for the 0=YES / 1=NO convention.
// All display components and filter queries must import from here.
// ---------------------------------------------------------------------------

/** Named constants for the integer outcome encoding used in the DB schema. */
export const Outcome = { YES: 0, NO: 1 } as const;

/** Returns "YES" or "NO" for a stored outcome integer. */
export function formatOutcome(outcome: number): "YES" | "NO" {
  if (outcome === Outcome.YES) return "YES";
  if (outcome === Outcome.NO) return "NO";
  throw new Error(`Unknown outcome value: ${outcome}`);
}

/** Returns true when outcome represents the YES side (outcome === 0). */
export function isYes(outcome: number): boolean {
  return outcome === Outcome.YES;
}
