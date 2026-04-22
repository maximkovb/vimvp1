import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computeMarketSuggestion } from "@/lib/services/marketSuggestion";
import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";

const MarketSuggestionSchema = z.object({
  videoId: z.string().regex(TIKTOK_VIDEO_ID_RE),
  title: z.string().min(1).max(200),
  channelTitle: z.string().min(1),
  publishedAt: z.string().datetime(),
  viewCount: z.number().int().min(0),
  likeCount: z.number().int().min(0),
});

/**
 * POST /api/admin/market-suggestion
 *
 * Bearer-token authenticated market suggestion for TikTok videos.
 * Returns an algorithmic contract recommendation based on video velocity.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Body: { videoId, title, channelTitle, publishedAt, viewCount, likeCount }
 *
 * Response: { contract, suggestedTitle, videoAgeHours, subscriberCount,
 *             channelAvgViews, duplicateWarning }
 */
export async function POST(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = MarketSuggestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await computeMarketSuggestion(parsed.data);
  return NextResponse.json(result);
}
