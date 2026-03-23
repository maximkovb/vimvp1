import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMContractRecommendation, RiskTier } from "./contract";

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
          "The 50th percentile (MEDIAN) projected views or likes at resolutionHours. NOT the mean or peak.",
      },
      resolutionHours: {
        type: "integer",
        enum: [24, 48, 72, 168],
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
      "reasoning",
    ],
  },
};

// Prompt engineering for 50th-percentile calibration.
// LLMs anchor to the mean by default. Four techniques to get the MEDIAN:
// 1. Explicit "median not mean" framing
// 2. Distribution-first reasoning (describe shape, then extract 10th/50th/90th pct)
// 3. Role framing as "calibrated forecaster" (not optimistic)
// 4. Explicit outlier suppression ("ignore viral top 10%")
const SYSTEM_PROMPT = `You are a calibrated viewership forecaster for a prediction market platform.

GOAL: Set milestoneThreshold at the MEDIAN (50th percentile) of expected outcome — the value where half of similar videos fall below and half above. Do NOT estimate the mean or average, which is skewed by viral outliers.

CALIBRATION APPROACH:
1. First, reason about the distribution shape (log-normal? heavy-tailed? consistent?).
2. Estimate the 20th and 80th percentile bounds to anchor your range.
3. Then set milestoneThreshold at the 50th percentile — the TYPICAL case, not the best case.
4. Ignore viral outlier scenarios (top 10%). Focus on the middle 80% of outcomes.

LMSR MARKET CONTEXT:
- bParameter controls price sensitivity. b=50: ~$35 moves price 50%→75%. b=200: ~$139.
- High confidence (consistent channel, established velocity) → lower b (50–75).
- Low confidence (chaotic channel, very new video) → higher b (130–200).

RESOLUTION WINDOW:
- 24h: strong viral velocity (high subscriber/view ratio), or video already > 12h old
- 48h: entertainment, gaming, consistent high-subscriber channels
- 72h: standard content, moderate confidence
- 168h: slow-burn educational, documentary, niche, or high uncertainty

QUESTION TYPE:
- "likes" when likeRatio > 3% AND content is music/meme/community-driven
- "views" for most content

The milestoneThreshold is a market bet — set it so you'd wager 50/50 whether the video exceeds it.`;

const ResponseSchema = z.object({
  // Pre-round floats before int check — Claude sometimes returns 524288.7
  milestoneThreshold: z
    .number()
    .transform(Math.round)
    .pipe(z.number().int().min(1).max(10_000_000_000)),
  resolutionHours: z.union([
    z.literal(24),
    z.literal(48),
    z.literal(72),
    z.literal(168),
  ]),
  // coerce handles string-typed numbers; clamp handles out-of-range values
  bParameter: z
    .coerce.number()
    .transform((v) => Math.round(Math.max(50, Math.min(200, v)))),
  questionTypeRecommendation: z.enum(["views", "likes"]),
  confidenceLevel: z.enum(["high", "medium", "low"]),
  reasoning: z.string().min(1).max(600),
});

function buildUserPrompt(ctx: VideoContext): string {
  // Clamp user-origin strings to limit prompt injection surface area
  const title = ctx.videoTitle.slice(0, 120);
  const channel = ctx.channelName.slice(0, 60);

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
  ]
    .filter((line) => line !== null)
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
    const riskTier: RiskTier =
      parsed.confidenceLevel === "high"
        ? "low"
        : parsed.confidenceLevel === "medium"
          ? "medium"
          : "high";

    return {
      riskTier,
      milestoneThreshold: parsed.milestoneThreshold,
      bParameter: parsed.bParameter,
      resolutionHours: parsed.resolutionHours,
      predictionSource: "llm",
      reasoning: parsed.reasoning,
      confidenceLevel: parsed.confidenceLevel,
      questionTypeRecommendation: parsed.questionTypeRecommendation,
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
