/** Only accept TikTok CDN thumbnail URLs in DB writes and API responses. */
export const TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//;

/**
 * Only accept known CDN play URL domains in DB writes.
 * TikWM returns direct MP4 URLs from TikTok's own CDN (*.tiktok.com, *.tiktokv.com,
 * *.tiktokcdn.com) and occasionally from its own CDN (*.tikwm.com).
 */
export const TIKTOK_PLAY_URL_RE =
  /^https:\/\/[a-z0-9-]+\.(tiktok\.com|tiktokv\.com|tiktokcdn(?:-us)?\.com|tikwm\.com)\//;

/** TikTok video IDs are 15–20 digit numeric strings. */
export const TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/;
