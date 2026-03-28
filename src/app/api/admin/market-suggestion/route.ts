import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computeMarketSuggestion } from "@/lib/services/marketSuggestion";

const MarketSuggestionSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  title: z.string().min(1).max(200),
  channelId: z.string().regex(/^UC[a-zA-Z0-9_-]{22}$/),
  channelTitle: z.string().min(1),
  publishedAt: z.string().datetime(),
  categoryId: z.string().optional(),
  viewCount: z.number().int().min(0),
  likeCount: z.number().int().min(0),
});

/**
 * POST /api/admin/market-suggestion
 *
 * Bearer-token authenticated equivalent of the generateMarketSuggestion() server action.
 * Fetches channel analytics, computes contract parameters (LLM + algorithmic fallback),
 * and returns a market suggestion with suggestedTitle and calibration data.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Body: { videoId, title, channelId, channelTitle, publishedAt, categoryId?,
 *         viewCount, likeCount }
 *
 * Response: { contract, suggestedTitle, videoAgeHours, subscriberCount,
 *             channelAvgViews, duplicateWarning }
 */
export async function POST(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 500 });
  }

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

  const result = await computeMarketSuggestion(parsed.data, apiKey);
  return NextResponse.json(result);
}
