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
          "A genuinely challenging target — set at 1.5–2× the algorithmic projection provided in the prompt for the chosen resolutionHours. Must be ABOVE the projection, never below it.",
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

// Prompt engineering for projection-anchored calibration.
// Target ~1.5–2× the algorithmic projection so YES resolves ~35–50% of the time.
const SYSTEM_PROMPT = `You are a calibrated viewership forecaster for a prediction market platform.

GOAL: Set milestoneThreshold at a genuinely challenging level — roughly 1.5–2× the algorithmic projection provided in the prompt for the chosen resolution window. This produces markets where YES has a real chance of NOT resolving (target: 35–50% YES rate). Do NOT set the threshold below the algorithmic projection — that produces trivially easy markets.

CALIBRATION APPROACH:
1. Read the "Algorithmic projection" lines in the prompt — these are your primary anchor.
2. For high-confidence/consistent channels (outperformance factor ≥ 1.5, consistency high): use 1.8–2.0× the projection.
3. For low-confidence/chaotic channels (outperformance factor < 1.0, consistency low): use 1.2–1.5× the projection.
4. Cap the multiplier at 3× to avoid absurd thresholds for mega-channels.

LMSR MARKET CONTEXT:
- bParameter controls price sensitivity. b=75: ~$52 moves price 50%→75%. b=150: ~$104.
- High confidence (consistent channel, established velocity) → lower b (75).
- Low confidence (chaotic channel, very new video) → higher b (150).

RESOLUTION WINDOW (choose based on video characteristics, NOT milestone hit probability):
- 24h: video is ≥12h old AND outperformance factor ≥ 3.0 (already viral — window closes soon)
- 48h: video is <36h old AND outperformance factor ≥ 1.5 (strong early momentum)
- 72h: default for all other cases including slow-burn or chaotic channels (hard maximum — never exceed 72h)

QUESTION TYPE:
- "likes" when likeRatio > 3% AND content is music/meme/community-driven
- "views" for most content`;

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

/** Logarithmic growth projection from current velocity to a future hour. */
function projectViews(
  currentViews: number,
  videoAgeHours: number,
  targetHours: number
): number {
  const safeAge = Math.max(videoAgeHours, 0.1);
  return Math.round(
    currentViews * (Math.log(targetHours + 1) / Math.log(safeAge + 1))
  );
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

  // Outperformance factor: how this video compares to the channel baseline
  // Guard against channelAvgViews = 0 (new channels with no history)
  const outperformanceFactor =
    ctx.channelAvgViews > 0
      ? +(ctx.currentViews / ctx.channelAvgViews).toFixed(2)
      : 1.0;

  // Projections at each candidate window — give the LLM concrete anchors for threshold setting
  const proj24 = projectViews(ctx.currentViews, ctx.videoAgeHours, 24);
  const proj48 = projectViews(ctx.currentViews, ctx.videoAgeHours, 48);
  const proj72 = projectViews(ctx.currentViews, ctx.videoAgeHours, 72);

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
    `Algorithmic projection (logarithmic growth from current velocity):`,
    `  - At 24h: ${proj24.toLocaleString()} views`,
    `  - At 48h: ${proj48.toLocaleString()} views`,
    `  - At 72h: ${proj72.toLocaleString()} views`,
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
