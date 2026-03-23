import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, priceSnapshots } from "@/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { getMarketPrices } from "@/lib/market-utils";
import { allPrices } from "@/lib/lmsr";
import { verifyCronAuth } from "@/lib/cron-auth";
import { z } from "zod";

const CreateMarketSchema = z.object({
  youtubeVideoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  questionType: z.enum(["views", "likes"]),
  milestoneThreshold: z.number().int().min(1).max(10_000_000_000),
  bParameter: z.number().min(1).max(1000),
  resolutionHours: z.union([
    z.literal(24),
    z.literal(48),
    z.literal(72),
    z.literal(168),
  ]),
  publishImmediately: z.boolean().default(false),
  videoMetadata: z.object({
    title: z.string(),
    thumbnail: z.string().default(""),
    channelTitle: z.string(),
  }),
});

// POST /api/markets — agent-accessible market creation (requires CRON_SECRET bearer token)
export async function POST(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateMarketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const now = new Date();
  const resolvesAt = new Date(
    now.getTime() + data.resolutionHours * 60 * 60 * 1000
  );
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);
  const marketId = crypto.randomUUID();

  await db.insert(markets).values({
    id: marketId,
    youtubeVideoId: data.youtubeVideoId,
    title: data.title,
    description: data.description ?? null,
    questionType: data.questionType,
    milestoneThreshold: BigInt(data.milestoneThreshold),
    bParameter: data.bParameter.toFixed(2),
    status: data.publishImmediately ? "active" : "draft",
    videoMetadata: data.videoMetadata,
    opensAt: data.publishImmediately ? now : null,
    haltsAt: data.publishImmediately ? haltsAt : null,
    resolvesAt: data.publishImmediately ? resolvesAt : null,
    createdBy: null, // API-created markets have no user session
  });

  if (data.publishImmediately) {
    const prices = allPrices([0, 0], data.bParameter);
    await db.insert(priceSnapshots).values({
      marketId,
      priceYes: prices[0].toFixed(6),
      priceNo: prices[1].toFixed(6),
    });
  }

  return NextResponse.json({ marketId }, { status: 201 });
}

// GET /api/markets — returns active/halted/resolving markets + last 6 resolved
export async function GET() {
  const [activeMarkets, resolvedMarkets] = await Promise.all([
    db
      .select()
      .from(markets)
      .where(
        or(
          eq(markets.status, "active"),
          eq(markets.status, "halted"),
          eq(markets.status, "resolving")
        )
      )
      .orderBy(desc(markets.createdAt))
      .limit(50),
    db
      .select()
      .from(markets)
      .where(eq(markets.status, "resolved"))
      .orderBy(desc(markets.resolvedAt))
      .limit(6),
  ]);

  const serialize = (market: (typeof markets.$inferSelect)[]) =>
    market.map((m) => {
      const [priceYes, priceNo] = getMarketPrices(m);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        status: m.status,
        questionType: m.questionType,
        milestoneThreshold: m.milestoneThreshold.toString(),
        priceYes,
        priceNo,
        outcome: m.outcome,
        resolvesAt: m.resolvesAt,
        resolvedAt: m.resolvedAt,
        videoMetadata: m.videoMetadata,
      };
    });

  return NextResponse.json({
    active: serialize(activeMarkets),
    resolved: serialize(resolvedMarkets),
  });
}
