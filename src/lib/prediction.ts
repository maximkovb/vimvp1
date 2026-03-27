import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMContractRecommendation, RiskTier } from "./contract";
import { CONFIDENCE_TO_RISK_TIER } from "./contract";
import {
  projectVelocity,
  channelAvgAtHorizon,
  computeExpectedOutcome,
  HORIZON_FRACTION,
} from "./calibration";

export interface VideoContext {
  // Identity
  videoTitle: string;
  channelName: string;
  videoCategory?: string;

  // Temporal
  videoAgeHours: number;
  publishedDayOfWeek: number; // 0 = Sunday … 6 = Saturday (UTC)
  publishedHourUTC: number; // 0–23

  // Performance primitives
  currentViews: number;
  currentLikes: number;

  // Channel primitives
  subscriberCount: number;
  channelAvgViews: number;
  channelStdDev: number;
}

// Lazy init — defers key check to call time, not module load time.
// If ANTHROPIC_API_KEY is missing, the throw is caught by admin.ts's try/catch → fallback.
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  return new Anthropic();
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
if (!process.env.ANTHROPIC_MODEL) {
  console.warn(
    "[prediction] ANTHROPIC_MODEL not set — defaulting to claude-sonnet-4-6. Set env var to pin model version and avoid silent drift."
  );
}

const PREDICTION_TOOL: Anthropic.Tool = {
  name: "set_contract_parameters",
  description:
    "Set the prediction market contract parameters based on video analytics.",
  input_schema: {
    type: "object",
    properties: {
      milestoneThreshold: {
        type: "integer",
        description:
          "The target view/like count. Must be >= 2.2× the expected outcome (max of velocity projection and channel avg at window horizon). Set it so estimatedProbability is 0.25–0.45.",
      },
      resolutionHours: {
        type: "integer",
        enum: [24, 48, 72],
      },
      bParameter: {
        type: "integer",
        minimum: 50,
        maximum: 200,
        description:
          "LMSR liquidity. High confidence → 50–75. Low confidence → 130–200.",
      },
      questionTypeRecommendation: {
        type: "string",
        enum: ["views", "likes"],
      },
      confidenceLevel: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      estimatedProbability: {
        type: "number",
        description:
          "Your estimated probability that YES resolves (0–1). Target 0.25–0.45 for a well-calibrated market. Compute as: expected_outcome / milestoneThreshold, where expected_outcome = max(velocity_projection, channel_avg × horizon_fraction).",
      },
      suggestedTitle: {
        type: "string",
        description:
          "An engaging market question using one of these frames: underdog ('Can this underdog Short crack {N} views in {W}h?') for small channels with high velocity; trending ('This Short is blowing up — will it hit {N} views in {W}h?') for outperformance > 3×; time-pressure ('Just {W}h to decide — will this Short crack {N} views?') for 24h windows; or default ('Will this Short hit {N} views in {W}h?'). Use actual numbers, not placeholders.",
      },
      reasoning: {
        type: "string",
        description:
          "2–4 sentences explaining the prediction. Mention key signals used.",
      },
    },
    required: [
      "milestoneThreshold",
      "resolutionHours",
      "bParameter",
      "questionTypeRecommendation",
      "confidenceLevel",
      "estimatedProbability",
      "suggestedTitle",
      "reasoning",
    ],
  },
};

// Prompt engineering for probability-anchored calibration.
// PRIMARY GOAL: estimatedProbability must be 0.25–0.45. Milestone >= 2.2× expected outcome.
const SYSTEM_PROMPT = `You are a calibrated viewership forecaster for a prediction market platform.

PRIMARY CALIBRATION RULE: Set milestoneThreshold so that estimatedProbability is between 0.25 and 0.45.
- Compute expected outcome: max(velocity_projection_at_chosen_window, channel_avg × horizon_fraction)
  where horizon_fraction = ${HORIZON_FRACTION[24]} for 24h, ${HORIZON_FRACTION[48]} for 48h, ${HORIZON_FRACTION[72]} for 72h
- Compute: estimatedProbability = expected_outcome / milestoneThreshold
- milestoneThreshold must always be >= 2.2× the expected outcome
- Do NOT set milestone below channel_avg × horizon_fraction — that is the baseline floor
- Target 0.30–0.40 for the most compelling markets (genuine risk of failure)
- A market where YES probability is 0.60+ is too easy — do not produce these
- Use the "Expected outcome floor" lines in the prompt as your floor — never go below them

CALIBRATION APPROACH:
1. Read the "Expected outcome floor" lines in the prompt — these are your hard minimums.
2. For high-confidence/consistent channels (outperformance ≥ 1.5, consistency high): use 2.8–3.2× the expected outcome.
3. For low-confidence/chaotic channels (outperformance < 1.0, consistency low): use 2.2–2.6× the expected outcome.

LMSR MARKET CONTEXT:
- bParameter controls price sensitivity. b=75: ~$52 moves price 50%→75%. b=150: ~$104.
- High confidence (consistent channel, established velocity) → lower b (75).
- Low confidence (chaotic channel, very new video) → higher b (150).

RESOLUTION WINDOW (choose based on video age — prefer shortest viable window):
- 24h: video is < 20h old (≥4h remains in window) — use for most fresh videos
- 48h: video is 20–43h old
- 72h: video is ≥44h old (hard maximum — never exceed 72h)

QUESTION TYPE:
- "likes" when likeRatio > 3% AND content is music/meme/community-driven
- "views" for most content

MARKET TITLE (suggestedTitle): Write an engaging question using one of these frames:
- Underdog (channel subs < 100K AND outperformance > 1.5×): "Can this underdog Short crack {N} views in {W}h?"
- Trending (outperformance > 3.0×): "This Short is blowing up — will it hit {N} views in {W}h?"
- Time-pressure (24h window): "Just 24h to decide — will this Short crack {N} views?"
- Default: "Will this Short hit {N} views in {W}h?"
Use actual numbers (e.g. "500,000 views"), not variable names. Adjust "views" to "likes" when questionTypeRecommendation is "likes".`;

const ResponseSchema = z.object({
  // Pre-round floats before int check — Claude sometimes returns 524288.7
  milestoneThreshold: z
    .number()
    .transform(Math.round)
    .pipe(z.number().int().min(1).max(10_000_000_000)),
  resolutionHours: z.union([z.literal(24), z.literal(48), z.literal(72)]),
  // coerce handles string-typed numbers; clamp handles out-of-range values
  bParameter: z
    .coerce.number()
    .transform((v) => Math.round(Math.max(50, Math.min(200, v)))),
  questionTypeRecommendation: z.enum(["views", "likes"]),
  confidenceLevel: z.enum(["high", "medium", "low"]),
  estimatedProbability: z.number().min(0).max(1),
  suggestedTitle: z.string().min(1).max(250),
  reasoning: z.string().min(1).max(600),
});

/**
 * Strip structural characters that could escape prompt boundaries,
 * then collapse whitespace and clamp to maxLen.
 */
function sanitizeForPrompt(s: string, maxLen: number): string {
  return s
    .slice(0, maxLen)
    .replace(/[\r\n"\\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// projectVelocity is imported from calibration.ts — no local duplicate needed.

function buildUserPrompt(ctx: VideoContext): string {
  // Sanitize user-origin strings — strips structural chars before LLM embedding (prompt injection)
  const title = sanitizeForPrompt(ctx.videoTitle, 120);
  const channel = sanitizeForPrompt(ctx.channelName, 60);

  // Compute derived signals here (not in the interface — callers pass primitives)
  const viewsPerHour = Math.round(ctx.currentViews / ctx.videoAgeHours);
  const likeRatioPct =
    ctx.currentViews > 0
      ? +((ctx.currentLikes / ctx.currentViews) * 100).toFixed(2)
      : 0;
  const subscriberViewRatioPct =
    ctx.subscriberCount > 0
      ? +((ctx.currentViews / ctx.subscriberCount) * 100).toFixed(3)
      : 0;
  const channelConsistencyPct =
    ctx.channelAvgViews > 0
      ? +((1 - ctx.channelStdDev / ctx.channelAvgViews) * 100).toFixed(1)
      : 0;

  // Outperformance factor: how this video compares to the channel baseline
  // Guard against channelAvgViews = 0 (new channels with no history)
  const outperformanceFactor =
    ctx.channelAvgViews > 0
      ? +(ctx.currentViews / ctx.channelAvgViews).toFixed(2)
      : 1.0;

  // Projections at each candidate window — give the LLM concrete anchors for threshold setting
  const proj24 = projectVelocity(ctx.currentViews, ctx.videoAgeHours, 24);
  const proj48 = projectVelocity(ctx.currentViews, ctx.videoAgeHours, 48);
  const proj72 = projectVelocity(ctx.currentViews, ctx.videoAgeHours, 72);

  // Expected outcome floor: max(velocity, channel avg × horizon fraction)
  // The LLM must set milestone above these values.
  const floor24 = computeExpectedOutcome(ctx.currentViews, ctx.videoAgeHours, 24, ctx.channelAvgViews);
  const floor48 = computeExpectedOutcome(ctx.currentViews, ctx.videoAgeHours, 48, ctx.channelAvgViews);
  const floor72 = computeExpectedOutcome(ctx.currentViews, ctx.videoAgeHours, 72, ctx.channelAvgViews);

  // Channel avg scaled to each window horizon (displayed for transparency)
  const chAvg24 = channelAvgAtHorizon(ctx.channelAvgViews, 24);
  const chAvg48 = channelAvgAtHorizon(ctx.channelAvgViews, 48);
  const chAvg72 = channelAvgAtHorizon(ctx.channelAvgViews, 72);

  // Labeled text format — more readable for the LLM than raw JSON
  return [
    `Video: "${title}" by ${channel}`,
    ctx.videoCategory ? `Category: ${ctx.videoCategory}` : null,
    `Age: ${ctx.videoAgeHours.toFixed(1)}h old`,
    `Published: ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][ctx.publishedDayOfWeek]} at ${ctx.publishedHourUTC}:00 UTC`,
    ``,
    `Current views: ${ctx.currentViews.toLocaleString()} (${viewsPerHour.toLocaleString()} views/hour)`,
    `Like ratio: ${likeRatioPct}%`,
    `Subscriber/view ratio at this age: ${subscriberViewRatioPct}% (higher = over-performing vs channel baseline)`,
    ``,
    `Channel: ${ctx.subscriberCount.toLocaleString()} subscribers`,
    `Channel avg views per video: ${Math.round(ctx.channelAvgViews).toLocaleString()}`,
    `Channel consistency score: ${channelConsistencyPct}% (100% = perfectly consistent, 0% = chaotic)`,
    `Outperformance factor: ${outperformanceFactor}x channel average`,
    ``,
    `Velocity projection (logarithmic growth from current velocity only):`,
    `  - At 24h: ${proj24.toLocaleString()} views`,
    `  - At 48h: ${proj48.toLocaleString()} views`,
    `  - At 72h: ${proj72.toLocaleString()} views`,
    ``,
    `Channel baseline floor at each window (channel avg × horizon fraction 0.55/0.80/1.00):`,
    `  - At 24h: ${chAvg24.toLocaleString()} views`,
    `  - At 48h: ${chAvg48.toLocaleString()} views`,
    `  - At 72h: ${chAvg72.toLocaleString()} views`,
    ``,
    `Expected outcome floor (max of velocity and channel baseline — milestone must exceed this):`,
    `  - At 24h: ${floor24.toLocaleString()} views  ← milestone must be >= 2.2× this = ${(floor24 * 2.2).toLocaleString()}`,
    `  - At 48h: ${floor48.toLocaleString()} views  ← milestone must be >= 2.2× this = ${(floor48 * 2.2).toLocaleString()}`,
    `  - At 72h: ${floor72.toLocaleString()} views  ← milestone must be >= 2.2× this = ${(floor72 * 2.2).toLocaleString()}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function generateContractPrediction(
  context: VideoContext
): Promise<LLMContractRecommendation> {
  // Guard against NaN/Infinity that could corrupt the prompt
  if (!isFinite(context.currentViews / context.videoAgeHours)) {
    throw new Error("VideoContext contains non-finite velocity values");
  }

  const client = getClient(); // lazy init — throws here if key missing → caught by caller

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(context) }],
        tools: [PREDICTION_TOOL],
        // Force this specific tool — "any" would allow text responses or other tools
        tool_choice: { type: "tool", name: "set_contract_parameters" },
      },
      {
        timeout: 7_500, // 7.5s — covers p95 Claude latency (4–6s) with headroom
        maxRetries: 0, // no retry: fallback immediately, don't double the worst-case wait
      }
    );

    // Check stop reason — max_tokens would produce truncated/malformed tool input
    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude response truncated (max_tokens reached)");
    }

    const toolUse = response.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
    );
    if (!toolUse) {
      throw new Error("Claude did not call the prediction tool");
    }

    // safeParse gives a structured error message for debugging, not a raw ZodError
    const result = ResponseSchema.safeParse(toolUse.input);
    if (!result.success) {
      throw new Error(
        `Invalid tool response: ${result.error.issues
          .map((i) => `${i.path.join(".")} — ${i.message}`)
          .join(", ")}`
      );
    }

    const parsed = result.data;
    const riskTier: RiskTier = CONFIDENCE_TO_RISK_TIER[parsed.confidenceLevel];

    return {
      riskTier,
      milestoneThreshold: parsed.milestoneThreshold,
      bParameter: parsed.bParameter,
      resolutionHours: parsed.resolutionHours,
      estimatedProbability: parsed.estimatedProbability,
      predictionSource: "llm",
      reasoning: parsed.reasoning,
      confidenceLevel: parsed.confidenceLevel,
      questionTypeRecommendation: parsed.questionTypeRecommendation,
      suggestedTitle: parsed.suggestedTitle,
    } satisfies LLMContractRecommendation;
  } catch (err) {
    // Classify errors for appropriate log verbosity
    if (err instanceof Anthropic.AuthenticationError) {
      // Permanent misconfiguration — log urgently, still fall back
      console.error(
        "[llm:CRITICAL] Auth failed — check ANTHROPIC_API_KEY",
        err.message
      );
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn("[llm:ratelimit]", err.headers?.get?.("retry-after"));
    } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
      console.warn("[llm:timeout] 7.5s budget exceeded");
    } else if (err instanceof Anthropic.APIError && err.status >= 500) {
      console.warn(`[llm:server-error] ${err.status}`);
    } else {
      console.warn(
        "[llm:fallback]",
        err instanceof Error ? err.message : String(err)
      );
    }
    throw err; // caller in admin.ts handles the fallback
  }
}
