import type { MarketStatus, QuestionType } from "@/db/schema";

export interface MarketData {
  id: string;
  title: string;
  description: string | null;
  status: MarketStatus;
  questionType: QuestionType;
  /** BigInt serialized as string to survive JSON round-trip */
  milestoneThreshold: string;
  videoId: string;
  platform: "youtube" | "tiktok" | "instagram";
  tikapiPostId?: string | null;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
    channelId?: string;
    description?: string;
    creatorId?: string;
  } | null;
  priceYes: number;
  priceNo: number;
  outcome: number | null;
  resolvesAt: string | null;
  resolvedAt: string | null;
  priceHistory: Array<{
    time: string;
    priceYes: number;
    priceNo: number;
    volumeTotal: number;
  }>;
  recentTrades: Array<{
    id: string;
    outcome: number;
    shares: number;
    cost: number;
    priceBefore: number;
    priceAfter: number;
    createdAt: string;
  }>;
  pollHistory: Array<{
    time: string;
    viewCount: number | null;
    likeCount: number | null;
  }>;
}
