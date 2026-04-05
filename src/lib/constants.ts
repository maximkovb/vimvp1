/** Only accept TikTok CDN thumbnail URLs in DB writes and API responses. */
export const TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//;

/** TikTok video IDs are 15–20 digit numeric strings. */
export const TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/;
