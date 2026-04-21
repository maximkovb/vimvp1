/** Only accept YouTube CDN thumbnail URLs in DB writes and API responses. */
export const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//;

/** YouTube channel IDs are always "UC" followed by 22 base64url characters. */
export const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/;

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Fetch timeout — prevents hung calls from blocking the worker budget. */
export const YT_TIMEOUT_MS = 8_000;

/** Only accept TikTok CDN thumbnail URLs in DB writes and API responses. */
export const TIKTOK_THUMBNAIL_RE = /^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//;

/** TikTok video IDs are 15–20 digit numeric strings. */
export const TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/;
