import { NextResponse } from "next/server";
import { db } from "@/db";
import { markets, priceSnapshots, tiktokPolls } from "@/db/schema";
import { desc, eq, or } from "drizzle-orm";
import { getMarketPrices } from "@/lib/market-utils";
import { allPrices } from "@/lib/lmsr";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computeExpectedOutcome, RESOLUTION_HOURS } from "@/lib/calibration";
import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";
import { z } from "zod";

const CreateMarketSchema = z
  .object({
    videoId: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    questionType: z.enum(["views", "likes"]),
    milestoneThreshold: z.number().int().min(1).max(10_000_000_000),
    bParameter: z.number().min(1).max(1000),
    resolutionHours: z.union(
      RESOLUTION_HOURS.map((h) => z.literal(h)) as [z.ZodLiteral<24>, z.ZodLiteral<48>, z.ZodLiteral<72>]
    ),
    publishImmediately: z.boolean().default(false),
    // Optional calibration fields — used to enforce the channel-baseline floor guard.
    // Omitting them degrades to velocity-only floor (same as when channel data is unavailable).
    initialViewCount: z.number().int().min(0).optional(),
    initialLikeCount: z.number().int().min(0).optional(),
    channelAvgViews: z.number().int().min(0).optional(),
    // publishedAt is the preferred way to supply video age — the server re-derives videoAgeHours
    // from it at request time, preventing callers from submitting a stale age.
    // videoAgeHours is accepted as a fallback when publishedAt is absent.
    publishedAt: z.string().datetime().optional(),
    videoAgeHours: z.number().min(0.1).optional(),
    videoMetadata: z.object({
      title: z.string(),
      thumbnail: z.string()
        .regex(/^https:\/\/[a-z0-9-]+\.tiktokcdn(?:-us)?\.com\//)
        .or(z.literal(""))
        .default(""),
      channelTitle: z.string(),
      description: z.string().max(5000).optional(),
      creatorId: z.string().optional(),
    }),
  })
  .superRefine((data, ctx) => {
    if (!TIKTOK_VIDEO_ID_RE.test(data.videoId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid TikTok video ID format (expected 15–20 digit numeric string)",
        path: ["videoId"],
      });
    }
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

  // Floor guard — mirrors createMarket() in admin.ts.
  // Prefer publishedAt for age derivation (server-computed, can't be spoofed).
  // Fall back to caller-supplied videoAgeHours, then 1h default.
  const floorBase = data.initialViewCount ?? 0;
  const floorChannelAvg = data.channelAvgViews ?? 0;
  const floorAge =
    data.publishedAt && !isNaN(Date.parse(data.publishedAt))
      ? Math.max((Date.now() - new Date(data.publishedAt).getTime()) / 3_600_000, 0.1)
      : (data.videoAgeHours ?? 1);
  const requiredFloor = computeExpectedOutcome(
    floorBase,
    floorAge,
    data.resolutionHours,
    floorChannelAvg
  );
  if (data.milestoneThreshold < requiredFloor) {
    return NextResponse.json(
      { error: `Milestone below expected outcome floor (minimum: ${requiredFloor.toLocaleString()})` },
      { status: 422 }
    );
  }

  const now = new Date();
  const resolvesAt = new Date(
    now.getTime() + data.resolutionHours * 60 * 60 * 1000
  );
  const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000);
  const marketId = crypto.randomUUID();

  // Atomic: market row + initial price snapshot + initial poll row in a single transaction.
  await db.transaction(async (tx) => {
    await tx.insert(markets).values({
      id: marketId,
      videoId: data.videoId,
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
      await tx.insert(priceSnapshots).values({
        marketId,
        priceYes: prices[0].toFixed(6),
        priceNo: prices[1].toFixed(6),
      });

      // Insert initial poll row so oracle has baseline data without waiting for first cron cycle.
      await tx.insert(tiktokPolls).values({
        marketId,
        viewCount: data.initialViewCount !== undefined ? BigInt(data.initialViewCount) : null,
        likeCount: data.initialLikeCount !== undefined ? BigInt(data.initialLikeCount) : null,
      });
    }
  });

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
