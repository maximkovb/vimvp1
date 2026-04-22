import { db } from "@/db";
import { markets } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import {
  calculateConfidence,
  calculateContractRecommendations,
  type ContractRecommendation,
  type LLMContractRecommendation,
} from "@/lib/contract";

export type MarketSuggestionInput = {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
};

export type MarketSuggestionResult = {
  contract: ContractRecommendation | LLMContractRecommendation | null;
  suggestedTitle: string | null;
  videoAgeHours: number;
  subscriberCount: number;
  channelAvgViews: number;
  duplicateWarning: boolean;
};

/**
 * Core market suggestion logic — no auth, no session dependency.
 *
 * Called by:
 * - `POST /api/admin/market-suggestion` API route (after verifyCronAuth() check)
 *
 * Each caller applies its own auth gate appropriate to its layer.
 * Returns algorithmic contract recommendations based on TikTok video velocity.
 */
export async function computeMarketSuggestion(
  input: MarketSuggestionInput
): Promise<MarketSuggestionResult> {
  const { videoId, publishedAt, viewCount } = input;

  const videoAgeHours = Math.max(
    (Date.now() - new Date(publishedAt).getTime()) / 3_600_000,
    0.1
  );

  // Warn if an active or draft market already exists for this video
  const existing = await db
    .select({ id: markets.id })
    .from(markets)
    .where(
      and(
        eq(markets.videoId, videoId),
        or(eq(markets.status, "active"), eq(markets.status, "draft"))
      )
    )
    .limit(1);
  const duplicateWarning = existing.length > 0;

  const confidence = calculateConfidence(videoAgeHours, [], undefined, undefined);
  const contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, [], viewCount);

  return {
    contract,
    suggestedTitle: null,
    videoAgeHours,
    subscriberCount: 0,
    channelAvgViews: viewCount,
    duplicateWarning,
  };
}
