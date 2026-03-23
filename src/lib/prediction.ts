import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMContractRecommendation, RiskTier } from "./contract";
import { CONFIDENCE_TO_RISK_TIER } from "./contract";

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
          "The 80th–85th percentile projected views or likes at resolutionHours — the value where only ~15–20% of similar-channel videos reach it. NOT the median or mean.",
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

// Prompt engineering for 85th-percentile calibration.
// Target the value only ~15% of similar-channel videos reach — risky but attainable.
const SYSTEM_PROMPT = `You are a calibrated viewership forecaster for a prediction market platform.

GOAL: Set milestoneThreshold at the 80th–85th percentile of expected outcome for this channel — the value where only ~15–20% of this channel's videos reach it. This makes the bet risky but attainable. Do NOT use the median or mean; those produce markets that are too easy to win.

CALIBRATION APPROACH:
1. Use the channel hit probability signal in the prompt (if provided) as your primary anchor.
2. Reason about the distribution shape (log-normal? heavy-tailed? consistent?).
3. Set milestoneThreshold at ~85th percentile — roughly 1-in-6 to 1-in-7 videos from this channel would reach it.
4. If the video is already tracking above the channel average, adjust up accordingly.

LMSR MARKET CONTEXT:
- bParameter controls price sensitivity. b=75: ~$52 moves price 50%→75%. b=150: ~$104.
- High confidence (consistent channel, established velocity) → lower b (75).
- Low confidence (chaotic channel, very new video) → higher b (150).

RESOLUTION WINDOW (rarity-first — use the channel hit probability signal):
- P < 10% (rarer than 1-in-10): 168h
- P 10–20% (1-in-5 to 1-in-10): 72h
- P ≥ 20% (easier than 1-in-5): 48h
- 24h: only for already-viral videos (12h+ old, tracking 3× channel average)

QUESTION TYPE:
- "likes" when likeRatio > 3% AND content is music/meme/community-driven
- "views" for most content

The milestoneThreshold is a market bet — set it so only ~15% of similar videos from this channel would exceed it.`;

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
