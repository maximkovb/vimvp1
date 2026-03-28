/** Only accept YouTube CDN thumbnail URLs in DB writes and API responses. */
export const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//;

/** YouTube channel IDs are always "UC" followed by 22 base64url characters. */
export const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/;

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Fetch timeout — prevents hung calls from blocking the worker budget. */
export const YT_TIMEOUT_MS = 8_000;
