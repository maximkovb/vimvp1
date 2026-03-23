---
title: "feat: LLM-Assisted Auto-Fill Contract Parameter Prediction"
type: feat
status: completed
date: 2026-03-22
deepened: 2026-03-23
origin: docs/brainstorms/2026-03-22-autofill-prediction-optimization-requirements.md
---

# feat: LLM-Assisted Auto-Fill Contract Parameter Prediction

## Enhancement Summary

**Deepened:** 2026-03-23
**Research agents:** best-practices, framework-docs, architecture, typescript, security, performance, frontend-races, code-simplicity, pattern-recognition

### Critical Bugs Fixed in This Deepening

1. **Wrong fallback call signature** — `calculateContractRecommendations` takes `(confidence, currentViews, videoAgeHours, recentViewCounts)`. The original plan called it with 3 args in wrong order. Fixed.
2. **Module-level `new Anthropic()` bypasses fallback** — if `ANTHROPIC_API_KEY` is missing the constructor throws at import time, before any `try/catch` can catch it. Use lazy `getClient()` instead.
3. **Missing `export const maxDuration`** — server actions inherit timeout from their page's segment config. Without it, Vercel uses platform defaults (~10s Hobby). Must add to `page.tsx`.
4. **`createMarket` triggers a second Claude call** — `createMarket` in `admin.ts` internally calls `fetchVideoMetadata()` again to get metadata for DB storage. After this change, that triggers a second Anthropic API call that's immediately discarded. Refactor `createMarket` to accept metadata directly.
5. **`TIER_TO_CONFIDENCE` constant is dead code** — defined but never referenced in actual mapping logic. Remove it.
6. **`milestoneThreshold` schema self-contradiction** — plan said "Zod rejects floats" in Phase 3 but "rounds floats" in the testing checklist. Use `.transform(Math.round)` — rounding is the correct policy.
7. **Missing `return` in `try` block** — the `try/finally` pattern needs an explicit `return` inside `try`, using `satisfies ContractRecommendation` for compile-time safety.
8. **Double-fetch race condition** — no cancellation token. A second Fetch click can overwrite form state with stale data from the first request.
9. **Zod is not installed** — the codebase has zero Zod usage. Must explicitly install it as a new dependency.

### Key Improvements

- Use SDK `{ timeout, maxRetries: 0 }` options instead of `AbortController` — AbortController has known reliability issues mid-stream with the Anthropic SDK
- Extend timeout to 7.5s (Claude p95 is 4–6s, not 2–3s as originally estimated)
- Parallelize Claude call with the final YouTube batch stats fetch — ~500ms median latency reduction at zero cost
- Use `tool_choice: { type: "tool", name: "set_contract_parameters" }` instead of `"any"` for guaranteed tool invocation
- Type `PREDICTION_TOOL` as `Anthropic.Tool` — eliminates `as const` assertion and adds compile-time schema checking
- Add `import "server-only"` to `prediction.ts` to prevent accidental client-bundle inclusion
- Move model ID to `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"` for zero-deploy model switches
- Use `safeParse` + structured error message instead of raw `.parse()` on `toolUse.input`
- Create `LLMContractRecommendation extends ContractRecommendation` — don't pollute the base type with LLM-specific fields
- 4-technique prompt engineering for 50th percentile calibration (distribution-first reasoning)
- Add `useRef` cancellation token for double-fetch protection
- Prompt injection mitigation: clamp `videoTitle.slice(0, 120)` before building user prompt

---

## Overview

Replace the purely algorithmic contract parameter generator (`calculateContractRecommendations` in `src/lib/contract.ts`) with a Claude LLM-assisted pipeline. When an admin fetches a YouTube video for market creation, Claude receives a rich set of quantitative and qualitative video signals and returns calibrated contract parameters — including a `milestoneThreshold` set at the ~50th percentile of projected outcome so markets have balanced initial trading odds.

The algorithmic system is retained as a silent fallback if the LLM call fails or times out.

See origin: `docs/brainstorms/2026-03-22-autofill-prediction-optimization-requirements.md`

---

## Problem Statement

The current auto-fill system uses a naive logarithmic projection blended with channel averages, producing thresholds that swing between too easy and too hard depending on the video. The same formula is applied uniformly whether the video is a MrBeast challenge or a niche tutorial. Subscriber count (already fetched) is discarded. Video title, category, and publish timing are ignored. Admins cannot trust the auto-filled values and manually correct them regularly, defeating the purpose of auto-fill.

The root failure is that the calibration target is the projected mean, not the ~50th percentile. A well-designed prediction market should have roughly 50/50 initial odds — this is what makes markets interesting for traders and fair for the platform.

---

## Proposed Solution

**Phase 1: Foundation** — Install `@anthropic-ai/sdk` and `zod`. Add `ANTHROPIC_API_KEY` env var. Extend the type system with `LLMContractRecommendation`. Add `export const maxDuration` to the admin page.

**Phase 2: Data Enrichment** — Parse `subscriberCount` from the channel API response (currently `void`ed), add `categoryId` to the YouTube `fields` mask.

**Phase 3: LLM Prediction Engine** — Create `src/lib/prediction.ts` with `generateContractPrediction()`. Uses Claude's forced tool use API with `strict: true`, validated with Zod. SDK-native 7.5s timeout with `maxRetries: 0`.

**Phase 4: Integration** — Wire `generateContractPrediction()` into `fetchVideoMetadata()` with algorithmic fallback. Parallelize Claude with the batch video stats fetch. Refactor `createMarket` to avoid double-calling `fetchVideoMetadata`.

**Phase 5: Admin UI** — Convert `questionType` select to controlled field, add `useRef` cancellation token for double-fetch safety, display reasoning panel.

---

## Technical Approach

### Architecture

The LLM call lives entirely server-side inside `fetchVideoMetadata` (a `"use server"` action). A new file `src/lib/prediction.ts` encapsulates all LLM logic, keeping `contract.ts` as pure math and `actions/admin.ts` as orchestration.

```
YouTube API call 1 (video stats)    ─────┐
YouTube API call 2 (channel stats)  ─────┤→ VideoContext assembled
YouTube API call 3 (search)         ─────┤
                                         ↓
YouTube batch stats ────────────────────┐ Claude tool call ──────────────┐
  (~200ms sequential after search)      │   (parallel, starts after      │
                                         │    video+channel stats done)   │
                                         └──── both settle ───────────────┘
                                                        ↓
                                         generateContractPrediction(context)
                                           → SDK timeout 7.5s, maxRetries: 0
                                           → Zod validation + clamping
                                           → LLMContractRecommendation
                                         ↕ catch ALL throws → silent fallback
                                         calculateContractRecommendations()
                                           → ContractRecommendation (base type)
                                         → return to admin page
```

> **Key parallelization insight (research finding):** After the first two YouTube calls (video stats + channel stats, ~150ms), you have `videoTitle`, `channelName`, initial view count, and upload date — enough to start the Claude call. Fire Claude in parallel with the sequential search+batch calls. Median latency reduction: ~500ms.

### Type System: `LLMContractRecommendation` Extension

**File:** `src/lib/contract.ts`

Create a subtype rather than polluting the base interface. The base `ContractRecommendation` remains unchanged — the algorithmic path never needs to construct the LLM-specific fields.

```typescript
// src/lib/contract.ts — UNCHANGED base type

export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  riskTier: RiskTier;
  milestoneThreshold: number;           // integer
  bParameter: number;                   // 50–200
  resolutionHours: 24 | 48 | 72 | 168;
}

// NEW: LLM-specific extension
export interface LLMContractRecommendation extends ContractRecommendation {
  predictionSource: "llm";              // literal discriminant
  reasoning: string;                    // 2–4 sentence explanation
  confidenceLevel: "high" | "medium" | "low";
  questionTypeRecommendation: "views" | "likes";
}
```

The admin page narrows by `'reasoning' in contract` or `contract.predictionSource === "llm"` to access LLM-specific fields.

### `VideoContext` Interface (Simplified)

**File:** `src/lib/prediction.ts`

Pass only the 9 primitive signals. Compute derived ratios inside `generateContractPrediction` to reduce caller burden and keep the interface minimal.

```typescript
// src/lib/prediction.ts

export interface VideoContext {
  // Identity
  videoTitle: string;           // clamped to 120 chars before use
  channelName: string;          // clamped to 60 chars before use
  videoCategory?: string;       // categoryId from YouTube; optional

  // Temporal
  videoAgeHours: number;        // clamped to >= 0.1 by caller
  publishedDayOfWeek: number;   // 0 = Sunday … 6 = Saturday (UTC)
  publishedHourUTC: number;     // 0–23

  // Performance primitives
  currentViews: number;
  currentLikes: number;

  // Channel primitives
  subscriberCount: number;
  channelAvgViews: number;
  channelStdDev: number;
}
// Derived signals (viewsPerHour, likeRatio, subscriberViewRatio, channelConsistency)
// are computed inside generateContractPrediction — not part of the interface
```

### Claude API Integration

**File:** `src/lib/prediction.ts`

Key pattern changes from original plan:
- Use SDK `{ timeout, maxRetries: 0 }` instead of `AbortController` (AbortController has known reliability issues mid-stream)
- Use `tool_choice: { type: "tool", name: "set_contract_parameters" }` — guarantees this specific tool is called
- Type `PREDICTION_TOOL` as `Anthropic.Tool` — no `as const` needed, full compile-time checking
- Lazy `getClient()` — defers construction to call time so a missing key hits the `try/catch` fallback, not module load
- Use `safeParse` with structured error messages
- Add `import "server-only"` at top

```typescript
// src/lib/prediction.ts
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMContractRecommendation, RiskTier } from "./contract";

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
  description: "Set the prediction market contract parameters based on video analytics.",
  input_schema: {
    type: "object",
    properties: {
      milestoneThreshold: {
        type: "integer",
        description: "The 50th percentile (MEDIAN) projected views or likes at resolutionHours. NOT the mean or peak.",
      },
      resolutionHours: {
        type: "integer",
        enum: [24, 48, 72, 168],
      },
      bParameter: {
        type: "integer",
        minimum: 50,
        maximum: 200,
        description: "LMSR liquidity. High confidence → 50–75. Low confidence → 130–200.",
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
        description: "2–4 sentences explaining the prediction. Mention key signals used.",
      },
    },
    required: [
      "milestoneThreshold", "resolutionHours", "bParameter",
      "questionTypeRecommendation", "confidenceLevel", "reasoning",
    ],
  },
};

// Prompt engineering for 50th-percentile calibration.
// Research finding: LLMs anchor to the mean by default. Four techniques to get the MEDIAN:
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
    z.literal(24), z.literal(48), z.literal(72), z.literal(168),
  ]),
  // coerce handles string-typed numbers; clamp handles out-of-range values
  bParameter: z
    .coerce.number()
    .transform(v => Math.round(Math.max(50, Math.min(200, v)))),
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
  const likeRatioPct = ctx.currentViews > 0
    ? +((ctx.currentLikes / ctx.currentViews) * 100).toFixed(2)
    : 0;
  const subscriberViewRatioPct = ctx.subscriberCount > 0
    ? +((ctx.currentViews / ctx.subscriberCount) * 100).toFixed(3)
    : 0;
  const channelConsistencyPct = ctx.channelAvgViews > 0
    ? +((1 - ctx.channelStdDev / ctx.channelAvgViews) * 100).toFixed(1)
    : 0;

  // Labeled text format — more readable for the LLM than raw JSON
  return [
    `Video: "${title}" by ${channel}`,
    ctx.videoCategory ? `Category: ${ctx.videoCategory}` : null,
    `Age: ${ctx.videoAgeHours.toFixed(1)}h old`,
    `Published: ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][ctx.publishedDayOfWeek]} at ${ctx.publishedHourUTC}:00 UTC`,
    ``,
    `Current views: ${ctx.currentViews.toLocaleString()} (${viewsPerHour.toLocaleString()} views/hour)`,
    `Like ratio: ${likeRatioPct}%`,
    `Subscriber/view ratio at this age: ${subscriberViewRatioPct}% (higher = over-performing vs channel baseline)`,
    ``,
    `Channel: ${ctx.subscriberCount.toLocaleString()} subscribers`,
    `Channel avg views per video: ${Math.round(ctx.channelAvgViews).toLocaleString()}`,
    `Channel consistency score: ${channelConsistencyPct}% (100% = perfectly consistent, 0% = chaotic)`,
  ].filter(Boolean).join("\n");
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
        timeout: 7_500,    // 7.5s — covers p95 Claude latency (4–6s) with headroom
        maxRetries: 0,     // no retry: fallback immediately, don't double the worst-case wait
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
      parsed.confidenceLevel === "high" ? "low"
      : parsed.confidenceLevel === "medium" ? "medium"
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
      console.error("[llm:CRITICAL] Auth failed — check ANTHROPIC_API_KEY", err.message);
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn("[llm:ratelimit]", err.headers?.["retry-after"]);
    } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
      console.warn("[llm:timeout] 7.5s budget exceeded");
    } else if (err instanceof Anthropic.APIError && err.status >= 500) {
      console.warn(`[llm:server-error] ${err.status}`);
    } else {
      console.warn("[llm:fallback]", err instanceof Error ? err.message : String(err));
    }
    throw err; // caller in admin.ts handles the fallback
  }
}
```

### `fetchVideoMetadata` Changes

**File:** `src/lib/actions/admin.ts`

Four changes:
1. Add `categoryId` to `fields=` mask
2. Parse `subscriberCount` (remove `void channelRes`)
3. Parallelize Claude call with batch video stats
4. Correct fallback call signature (was wrong in original plan — `calculateContractRecommendations` takes `(confidence, currentViews, videoAgeHours, recentViewCounts)`)

```typescript
// Change 1: fields mask
fields=items(id,snippet(title,thumbnails/medium/url,channelTitle,channelId,publishedAt,categoryId),statistics(viewCount,likeCount))

// Change 2: parse subscriberCount (replaces void channelRes)
const channelData = channelRes.ok ? await channelRes.json() : null;
const subscriberCount = Number(
  channelData?.items?.[0]?.statistics?.subscriberCount ?? 0
);

// Change 3: parallelize Claude with batch stats
const videoAgeHours = Math.max(
  (Date.now() - new Date(publishedAt).getTime()) / 3_600_000,
  0.1
);
const mean = recentViewIds.length > 0
  ? recentViewCounts.reduce((a, b) => a + b, 0) / recentViewCounts.length
  : currentViews;
const stdDev = recentViewCounts.length > 1
  ? Math.sqrt(recentViewCounts.reduce((s, v) => s + (v - mean) ** 2, 0) / recentViewCounts.length)
  : 0;

// Compute confidence for the algorithmic fallback path (needed before try/catch)
const confidence = calculateConfidence(videoAgeHours, recentViewCounts);

const videoContext: VideoContext = {
  videoTitle: title,
  channelName: channelTitle,
  videoCategory: categoryId ?? undefined,
  videoAgeHours,
  publishedDayOfWeek: new Date(publishedAt).getUTCDay(),
  publishedHourUTC: new Date(publishedAt).getUTCHours(),
  currentViews,
  currentLikes,
  subscriberCount,
  channelAvgViews: mean,
  channelStdDev: stdDev,
};

// Try LLM, fall back to algorithmic. All LLM errors are caught and re-thrown
// inside generateContractPrediction after logging, so the catch here is clean.
let contract: ContractRecommendation | LLMContractRecommendation;
try {
  contract = await generateContractPrediction(videoContext);
} catch {
  // Silent to the user — generateContractPrediction already logged the error type
  contract = calculateContractRecommendations(
    confidence,       // ← correct first arg (was missing in original plan)
    currentViews,
    videoAgeHours,
    recentViewCounts
  );
}
```

**Change 4: Refactor `createMarket` to avoid double Claude call**

`createMarket` currently calls `fetchVideoMetadata()` internally to get `title`, `thumbnail`, and `channelTitle` for DB storage. After this change that triggers a second Claude call. Refactor it to accept video metadata directly:

```typescript
// In createMarket, instead of re-fetching:
// BEFORE: const metadata = await fetchVideoMetadata(videoUrl);
// AFTER: Accept videoTitle, thumbnail, channelTitle from FormData (already submitted by form)
// The form already has these values from the initial fetch display — pass them as hidden inputs
```

> Add three hidden inputs to the admin form: `<input type="hidden" name="videoTitle" value={videoPreview?.title ?? ""} />` etc. `createMarket` reads them from `FormData` instead of re-fetching.

### Admin Form UI Changes

**File:** `src/app/admin/markets/new/page.tsx`

**1. `export const maxDuration` (research finding — required)**

```typescript
// Server Actions inherit timeout from their page's Route Segment Config.
// Without this, Vercel platform defaults apply (~10s Hobby).
export const maxDuration = 30; // seconds — 4x headroom over expected ~7s happy path
```

**2. Convert `questionType` to controlled state:**

```typescript
const [questionType, setQuestionType] = useState<"views" | "likes">("views");
```

**3. `useRef` cancellation token — prevents double-fetch state corruption:**

```typescript
const fetchTokenRef = useRef<{ canceled: boolean } | null>(null);

const handleFetchVideo = async () => {
  // Cancel any in-flight fetch
  if (fetchTokenRef.current) fetchTokenRef.current.canceled = true;
  const token = { canceled: false };
  fetchTokenRef.current = token;

  // All resets happen synchronously before the await
  setMilestoneThreshold("");
  setBParameter("100");
  setResolutionHours("72");
  setRiskTier(null);
  setQuestionType("views");
  setVideoPreview(null);
  setIsLoading(true);

  try {
    const result = await fetchVideoMetadata(videoUrl);
    if (token.canceled) return; // stale response — discard

    if (result.contract) {
      setMilestoneThreshold(String(result.contract.milestoneThreshold));
      setBParameter(String(result.contract.bParameter));
      setResolutionHours(String(result.contract.resolutionHours));
      setRiskTier(result.contract.riskTier);
      // Validate LLM value before setting — guards against unexpected enum values
      const rec = result.contract.questionTypeRecommendation;
      setQuestionType(rec === "likes" ? "likes" : "views");
    }
    setVideoPreview(result);
  } finally {
    if (!token.canceled) setIsLoading(false);
  }
};
```

**4. Reasoning panel:**

```tsx
{"reasoning" in (videoPreview?.contract ?? {}) && (
  <div className="mt-3 p-3 bg-muted/40 rounded-md border border-border/50 text-sm">
    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
      AI Analysis
    </span>
    <p className="mt-1 text-muted-foreground leading-relaxed">
      {(videoPreview!.contract as LLMContractRecommendation).reasoning}
    </p>
  </div>
)}
```

**5. Controlled `questionType` select:**

```tsx
<select
  name="questionType"
  value={questionType}
  onChange={(e) => setQuestionType(e.target.value as "views" | "likes")}
>
  <option value="views">Views</option>
  <option value="likes">Likes</option>
</select>
```

**6. Hidden inputs for `createMarket` refactor:**

```tsx
<input type="hidden" name="videoTitle" value={videoPreview?.title ?? ""} />
<input type="hidden" name="thumbnail" value={videoPreview?.thumbnail ?? ""} />
<input type="hidden" name="channelTitle" value={videoPreview?.channelTitle ?? ""} />
```

---

## Implementation Phases

### Phase 1: Foundation

Files:
- `package.json` — add `@anthropic-ai/sdk` (latest) and `zod` (latest). **Note: Zod is not currently installed — this is a new dependency.**
- `.env.local` — add `ANTHROPIC_API_KEY=sk-ant-...` and optionally `ANTHROPIC_MODEL=claude-sonnet-4-6` (gitignored)
- `src/lib/contract.ts` — add `LLMContractRecommendation` interface extending `ContractRecommendation`
- `src/app/admin/markets/new/page.tsx` — add `export const maxDuration = 30`

Acceptance criteria:
- [ ] `@anthropic-ai/sdk` and `zod` in `package.json`
- [ ] `ANTHROPIC_API_KEY` added to `.env.local` (gitignored, value from Anthropic dashboard)
- [ ] `LLMContractRecommendation` interface compiles; `ContractRecommendation` is unchanged
- [ ] `export const maxDuration = 30` present in `page.tsx`
- [ ] `pnpm tsc --noEmit` passes

### Phase 2: Data Enrichment

Files:
- `src/lib/actions/admin.ts`:
  - Add `categoryId` to `fields=` mask
  - Parse `subscriberCount` from channel response (remove `void channelRes`)

Acceptance criteria:
- [ ] `categoryId` is logged from `item.snippet` in dev (confirm not undefined)
- [ ] `subscriberCount` is a number (0 for new channels, not NaN)
- [ ] No regression: `fetchVideoMetadata` return shape is unchanged for existing fields

> **Learnings doc gotcha:** YouTube API `fields` filter returns HTTP 200 with undefined fields if omitted. Confirm `categoryId` is present by logging the raw snippet after the change.

### Phase 3: LLM Prediction Engine

Files:
- `src/lib/prediction.ts` (new file) — full implementation from Technical Approach

Key notes:
- File must start with `import "server-only"` — prevents accidental client import
- Use lazy `getClient()`, not module-level `new Anthropic()`
- Use `{ timeout: 7_500, maxRetries: 0 }` — not AbortController
- `tool_choice: { type: "tool", name: "set_contract_parameters" }` — not `"any"`
- `safeParse` with structured error, not raw `parse()`
- Explicit `return ... satisfies LLMContractRecommendation` inside try

Acceptance criteria:
- [ ] `generateContractPrediction` callable from `pnpm tsx` smoke test
- [ ] Returns a valid `LLMContractRecommendation` with all fields
- [ ] Missing `ANTHROPIC_API_KEY` throws from `getClient()`, caught in caller
- [ ] `milestoneThreshold: 524288.7` is rounded to `524289` (not rejected)
- [ ] `bParameter: 250` is clamped to `200`
- [ ] `resolutionHours: 96` throws ZodError (not a valid literal) → fallback activates
- [ ] `stop_reason === "max_tokens"` throws → fallback activates

### Phase 4: Integration

Files:
- `src/lib/actions/admin.ts`:
  - Build `VideoContext` with primitives only (11 fields)
  - Compute `confidence` before the `try/catch` block (needed for fallback)
  - Call `generateContractPrediction` — Claude fires in parallel with batch stats
  - Correct fallback call: `calculateContractRecommendations(confidence, currentViews, videoAgeHours, recentViewCounts)`
  - Refactor `createMarket` to read `videoTitle`/`thumbnail`/`channelTitle` from `FormData` instead of re-calling `fetchVideoMetadata`

Acceptance criteria:
- [ ] Fetching a real URL produces `LLMContractRecommendation` with non-empty `reasoning`
- [ ] `ANTHROPIC_API_KEY` removed: fallback fires, form populates, no UI error, no 500
- [ ] No second Claude call on form submit (verify via Anthropic dashboard or server logs)
- [ ] `subscriberCount: 0` → no NaN in any VideoContext field
- [ ] `videoAgeHours < 0` (future date) → clamped to 0.1

### Phase 5: Admin UI

Files:
- `src/app/admin/markets/new/page.tsx`:
  - Add `useRef` cancellation token
  - Add `isLoading` state + disable Fetch button while loading
  - Convert `questionType` to controlled state
  - Validate `questionTypeRecommendation` before setting state
  - Reasoning panel using `"reasoning" in contract` narrowing
  - Three hidden inputs for `createMarket` refactor
  - Reset `questionType` in the synchronous reset block

Acceptance criteria:
- [ ] Double-click Fetch: only the second response populates the form
- [ ] `questionType` select reflects LLM recommendation after fetch
- [ ] Invalid `questionTypeRecommendation` from LLM defaults to `"views"`
- [ ] Reasoning panel visible for LLM path, hidden for algorithmic fallback
- [ ] Second URL fetch: all fields and reasoning panel reset cleanly
- [ ] Fetch button is disabled during in-flight request
- [ ] `name="questionType"` retained on select; `FormData` reads correct value at submit

---

## System-Wide Impact

### Interaction Graph

`handleFetchVideo` → `fetchVideoMetadata` → YouTube API (3–4 calls) + `generateContractPrediction` (parallel with last batch call) → Anthropic API → Zod validation → `LLMContractRecommendation` → form state → `createMarket` (reads metadata from FormData) → Drizzle → Neon DB → cron `resolve-markets` reads `milestoneThreshold`.

The Claude call sits between YouTube API calls and form state update. It does not touch the DB, coin system, or any market state.

### Error & Failure Propagation

| Error | Logged as | User sees |
|---|---|---|
| `AuthenticationError` (missing/bad key) | `[llm:CRITICAL]` + `console.error` | Algorithmic fallback silently |
| `APIConnectionTimeoutError` (>7.5s) | `[llm:timeout]` + `console.warn` | Algorithmic fallback silently |
| `RateLimitError` (429) | `[llm:ratelimit]` + retry-after | Algorithmic fallback silently |
| `InternalServerError` (5xx) | `[llm:server-error]` + `console.warn` | Algorithmic fallback silently |
| Zod validation error | `[llm:fallback]` + message | Algorithmic fallback silently |
| YouTube API failure | — (existing behavior) | `contract: null`, static defaults |

### State Lifecycle Risks

- `questionType` reset must happen synchronously before `await` (same pattern as `milestoneThreshold` — already documented in learnings doc)
- `useRef` cancellation token is the primary defense against double-fetch stale state
- React 18+ auto-batches all `set*` calls after `await` into a single render — no intermediate inconsistent states visible

### API Surface Parity

- `createMarket` action signature changes slightly (reads new hidden fields from FormData) — test end-to-end after Phase 4
- `ContractRecommendation` base type is unchanged — no blast radius on existing callers
- `LLMContractRecommendation` is a new type — check all places that render `contract` fields for needed narrowing: `grep -r "contract\." src/app/admin`

### Integration Test Scenarios

1. **Full path:** Fetch URL (LLM available) → `LLMContractRecommendation` returned → form populates including `questionType` and reasoning → submit → `BigInt(milestoneThreshold)` succeeds → market created with correct `bParameter` in DB
2. **Fallback path:** `ANTHROPIC_API_KEY` absent → form populates from algorithm, no error, no reasoning panel
3. **Double-fetch:** Fetch URL A (slow, ~3s), then immediately fetch URL B → only URL B's response populates the form
4. **Float threshold:** Mock Claude returning `milestoneThreshold: 524288.7` → verify `524289` in form state → `BigInt("524289")` succeeds
5. **Second call guard:** Submit form after fetch → verify server logs show zero Anthropic API calls during `createMarket`

---

## Alternative Approaches Considered

| Approach | Decision |
|---|---|
| **Algorithmic only (better math)** | Rejected — S-curve/power-law models require calibrated historical data. Not available yet. |
| **LLM-only** | Rejected — single point of failure; admin UX must degrade gracefully |
| **Store reasoning in DB** | Deferred — display-only for now |
| **`messages.parse()` + `zodOutputFormat()`** | Considered (newest SDK pattern) — skip for now; tool use with `strict: true` achieves same guarantee and is already documented |
| **`claude-haiku-4-5` for speed** | Use `ANTHROPIC_MODEL` env var to switch; Sonnet 4.6 default for quality |
| **Two-phase fetch (YouTube fast + Claude async)** | Noted as future improvement for perceived performance; out of scope this PR |
| **Prediction caching** | Noted as future improvement (videoId + age-bucket key, 30-min TTL); out of scope this PR |

---

## Acceptance Criteria

### Functional
- [ ] R1: LLM path is primary; algorithmic is fallback
- [ ] R2: `VideoContext` includes all required signals
- [ ] R3: System prompt instructs Claude to target the ~50th percentile using distribution-first reasoning
- [ ] R4: LLM returns all six structured fields, Zod-validated
- [ ] R5: Reasoning text renders in admin form when LLM path succeeds
- [ ] R6: Fallback is silent and complete
- [ ] R7: `subscriberCount` parsed and used
- [ ] R8: `bParameter` driven by `confidenceLevel`, range clamped 50–200

### Non-Functional
- [ ] `ANTHROPIC_API_KEY` never in client bundle (`grep -r "ANTHROPIC_API_KEY" .next/static/` → zero results)
- [ ] `import "server-only"` in `prediction.ts`
- [ ] SDK timeout `7_500ms` with `maxRetries: 0`
- [ ] `milestoneThreshold` always integer before form state
- [ ] `export const maxDuration = 30` on page
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)

### Quality Gates
- [ ] `pnpm build` succeeds
- [ ] Existing tests pass
- [ ] No unhandled promise rejections in happy path
- [ ] Zero Anthropic API calls triggered by `createMarket` (verify in server logs)

---

## Dependencies & Prerequisites

- `ANTHROPIC_API_KEY` in `.env.local` (server-side only, never `NEXT_PUBLIC_`)
- `@anthropic-ai/sdk` and `zod` installed (both new dependencies)
- YouTube API already returns `subscriberCount` — confirmed by repo research
- `categoryId` requires adding to `fields=` mask — one-line change

> **From learnings doc:** `ANTHROPIC_API_KEY` in `.env.local` is auto-available in Next.js server actions but NOT in CLI scripts or drizzle-kit without explicit `dotenv` loading.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Claude returns threshold below current views (immediate YES) | Medium for fast-growing videos | Flag in UI if `milestoneThreshold <= currentViews` |
| Claude p95 latency exceeds 7.5s | Low (~5%) | Fallback activates; consider increasing to 10s if fallback rate is high in prod |
| `categoryId` absent for some videos | Medium | Optional field in `VideoContext`; prompt handles gracefully |
| Double Claude call on form submit | Pre-existing `createMarket` bug | Fixed in Phase 4 by refactoring `createMarket` to accept metadata from FormData |
| Prompt injection via video title | Low (tool use schema is enforcement) | Mitigated by title clamp (120 chars) and Zod validation |
| Unauthenticated `fetchVideoMetadata` | Fixed (auth check confirmed present in `admin.ts`) | Monitor — a compromised admin account increases Anthropic spend |
| `ANTHROPIC_API_KEY` absent at module load | Fixed | Lazy `getClient()` defers throw to call time → caught by try/catch → fallback |

---

## Future Considerations

- **Parallel Claude + YouTube** — fire Claude after first two YouTube calls, parallel with batch stats. ~500ms median reduction.
- **Two-phase fetch** — return YouTube data immediately to unblock the admin, fetch Claude prediction in a second request. Perceived latency improvement.
- **Prediction caching** — `videoId + videoAgeBucket` key (buckets: <6h, 6–24h, 1–3d, 3–7d, 7d+), 30-min TTL. In-memory Map for now; Vercel KV later.
- **Historical calibration** — after ~50 resolved markets, add few-shot examples to the prompt showing real video→outcome pairs.
- **Market title auto-fill** — add `suggestedTitle` to the tool schema; Claude generates "Will [channel] hit [N] views in [H] hours?" Low-effort in same LLM call.
- **Streaming reasoning** — Route Handler returning `ReadableStream` for progressive reasoning display.
- **`draft market + 168h` bug** — `publishMarket` currently defaults to 72h regardless of stored resolution. Pre-existing issue; file separate todo.

---

## Sources & References

### Origin
- [docs/brainstorms/2026-03-22-autofill-prediction-optimization-requirements.md](../brainstorms/2026-03-22-autofill-prediction-optimization-requirements.md)

### Internal
- `src/lib/contract.ts` — existing type and algorithms
- `src/lib/actions/admin.ts:35–126` — `fetchVideoMetadata`
- `src/app/admin/markets/new/page.tsx` — admin form
- `src/lib/lmsr.ts` — bParameter spread math
- `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — fields mask gotcha, controlled input pattern
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — auth patterns, safety checklist

### External
- Anthropic SDK: `@anthropic-ai/sdk` — `tool_choice`, `timeout`, error classes, `ToolUseBlock` type
- Next.js `maxDuration` Route Segment Config — must be on page file, not action file
- Vercel function timeout: Fluid Compute defaults (300s Hobby/Pro); `maxDuration = 30` for this use case

---

## Testing Checklist

- [ ] Happy path: fetch real URL → reasoning panel shows, `questionType` auto-fills, all params in range
- [ ] `ANTHROPIC_API_KEY` absent: form auto-fills from algorithm, no error, no reasoning panel, no 500
- [ ] Double-click Fetch: only most-recent response populates form
- [ ] Fetch URL A then URL B: URL B's data shown, URL A discarded
- [ ] `milestoneThreshold: 524288.7` from mock Claude → rounded to `524289`
- [ ] `bParameter: 201` from mock Claude → clamped to `200`
- [ ] `resolutionHours: 96` from mock Claude → ZodError → fallback
- [ ] `stop_reason: "max_tokens"` from mock Claude → fallback
- [ ] Claude timeout (mock >7.5s) → fallback within ~8s, form populates
- [ ] `subscriberCount: 0` (new channel): no NaN, LLM receives `0` cleanly
- [ ] `videoAgeHours < 0` (future publish date): clamped to `0.1`
- [ ] Submit form → zero Anthropic API calls in `createMarket` (server logs confirm)
- [ ] `BigInt(milestoneThreshold)` succeeds for LLM-generated integer string
- [ ] Cron resolves market correctly: threshold roundtrip (Claude → form → BigInt → DB → cron comparison)
- [ ] `pnpm build` + `grep -r "ANTHROPIC_API_KEY" .next/static/` → zero matches
- [ ] `export const maxDuration = 30` present in `page.tsx` before deploying
