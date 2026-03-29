---
title: "LLM-assisted contract parameter pipeline: median calibration, lazy client init, and form race conditions"
category: integration-issues
date: 2026-03-23
tags: [anthropic-sdk, tool-use, zod, next-js, server-actions, prediction-markets, typescript, race-condition, fallback-pattern]
module: src/lib/prediction.ts
symptom: "Admin market creation auto-filled contract parameters using a naive logarithmic formula calibrated to the mean, producing systematically unbalanced markets; subscriber count, video title, category, and publish timing were all ignored"
root_cause: "Naive log formula targeted the mean rather than the median (~50th percentile); replacing it with an Anthropic SDK forced-tool-use pipeline introduced six secondary bugs: module-level SDK instantiation throwing at import when ANTHROPIC_API_KEY is absent, wrong fallback call signature, double fetchVideoMetadata() triggering a second Claude call inside createMarket, unreliable AbortController mid-stream, tool_choice: 'any' not guaranteeing tool invocation, and a double-fetch race condition in the admin form"
---

# LLM-Assisted Contract Parameter Generation in Next.js Server Actions

## Problem Description

The admin market creation form auto-populated contract parameters (`milestoneThreshold`, `bParameter`, `resolutionHours`) using a purely algorithmic formula. Because YouTube view distributions are log-normal and right-skewed, a mean-calibrated formula consistently overestimated expected performance — markets resolved YES less than 50% of the time. The same formula was applied uniformly regardless of video title, category, channel consistency, publish timing, or subscriber count (all of which were available but discarded).

## Root Cause

`calculateContractRecommendations()` targeted the projected **mean** rather than the **median (~50th percentile)**. Replacing it with a Claude LLM pipeline (`src/lib/prediction.ts`) surfaced six secondary bugs in the integration:

1. Module-level SDK client init throws at import time if `ANTHROPIC_API_KEY` is missing
2. Wrong fallback function call signature (wrong arg order, missing `confidence`)
3. `createMarket` internally re-called `fetchVideoMetadata()` → triggered a second Claude call on every form submit
4. `AbortController` has known reliability issues mid-stream with the Anthropic SDK
5. `tool_choice: "any"` allows text responses or wrong tool — does not guarantee tool invocation
6. Double-fetch race condition: second response could arrive after first and overwrite form state

## Working Solution

### 1. Lazy Client Initialization (Critical for Fallback Correctness)

Initializing the SDK at module level throws before any `try/catch` in the caller can catch it — the fallback **never fires**.

```typescript
// WRONG — throws at module load time if ANTHROPIC_API_KEY missing
const client = new Anthropic(); // module level

// CORRECT — throws at call time → caught by caller's try/catch → fallback activates
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  return new Anthropic();
}
```

### 2. Force the Specific Tool

`tool_choice: "any"` allows text responses or invocation of a different tool.

```typescript
// WRONG
tool_choice: "any"

// CORRECT — guarantees set_contract_parameters is called
tool_choice: { type: "tool", name: "set_contract_parameters" }
```

### 3. SDK-Native Timeout (Not AbortController)

`AbortController` has known reliability issues mid-stream with the Anthropic SDK. Use the SDK's own options.

```typescript
await client.messages.create(
  { model, max_tokens: 1024, tools, tool_choice, messages },
  { timeout: 7_500, maxRetries: 0 }  // SDK RequestOptions — NOT AbortController
);
// 7.5s covers p95 Claude latency (4–6s) with headroom
// maxRetries: 0 → fall back immediately, don't double the worst-case wait
```

### 4. Zod `safeParse` on Tool Response

`parse()` throws an unstructured `ZodError`. `safeParse` lets you construct a descriptive message for logging.

```typescript
const result = ResponseSchema.safeParse(toolUse.input);
if (!result.success) {
  throw new Error(
    `Invalid tool response: ${result.error.issues
      .map((i) => `${i.path.join(".")} — ${i.message}`)
      .join(", ")}`
  );
}
```

Zod schema patterns for LLM numeric output:

```typescript
const ResponseSchema = z.object({
  // Pre-round floats before int check — LLMs sometimes return 524288.7
  milestoneThreshold: z
    .number()
    .transform(Math.round)
    .pipe(z.number().int().min(1).max(10_000_000_000)),
  // coerce handles string-typed numbers; clamp handles out-of-range
  bParameter: z
    .coerce.number()
    .transform((v) => Math.round(Math.max(50, Math.min(200, v)))),
  resolutionHours: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(168)]),
});
```

### 5. Correct Fallback Call Signature

Compute `confidence` **before** the `try/catch` block — it must be available for both paths.

```typescript
// Signature: calculateContractRecommendations(confidence, currentViews, videoAgeHours, recentViewCounts)
const confidence = calculateConfidence(videoAgeHours, recentViewCounts); // BEFORE try/catch

let contract: ContractRecommendation | LLMContractRecommendation;
try {
  contract = await generateContractPrediction(videoContext);
} catch {
  // generateContractPrediction already logged the error — this catch is clean
  contract = calculateContractRecommendations(confidence, currentViews, videoAgeHours, recentViewCounts);
}
```

### 6. Avoid Double API Calls from Form Submit

A server action that internally calls another server action that makes an external API call triggers a second LLM call on every submit. Pass metadata through hidden form inputs instead of re-fetching.

```tsx
// In page.tsx — pass preview data as hidden inputs
<input type="hidden" name="videoTitle" value={videoPreview?.title ?? ""} />
<input type="hidden" name="thumbnail" value={videoPreview?.thumbnail ?? ""} />
<input type="hidden" name="channelTitle" value={videoPreview?.channelTitle ?? ""} />

// In createMarket server action — read from formData instead of re-calling fetchVideoMetadata
const videoTitle = formData.get("videoTitle") as string;
const thumbnail = formData.get("thumbnail") as string;
const channelTitle = formData.get("channelTitle") as string;
```

### 7. TypeScript `Headers` Type — Use `.get()` Not Bracket Access

```typescript
// WRONG — TS error: type 'Headers' has no index signature
err.headers?.["retry-after"]

// CORRECT
err.headers?.get?.("retry-after")
```

### 8. `useRef` Cancellation Token for Double-Fetch

Prevents a stale first-fetch response from overwriting form state set by a second fetch that completed first.

```typescript
const fetchTokenRef = useRef<{ canceled: boolean } | null>(null);

const handleFetchVideo = async () => {
  if (fetchTokenRef.current) fetchTokenRef.current.canceled = true;
  const token = { canceled: false };
  fetchTokenRef.current = token;

  // All resets happen synchronously before the await
  setMilestoneThreshold("");
  setQuestionType("views");
  setIsLoading(true);

  try {
    const result = await fetchVideoMetadata(videoUrl);
    if (token.canceled) return; // stale response — discard
    // set state...
  } finally {
    if (!token.canceled) setIsLoading(false);
  }
};
```

### 9. LLM Subtype Pattern (Don't Pollute Base Type)

The base type is left unchanged so the algorithmic fallback requires no modification.

```typescript
// Base type unchanged — algorithmic path never constructs LLM fields
export interface ContractRecommendation {
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72 | 168;
}

// Extend with a literal discriminant for safe narrowing
export interface LLMContractRecommendation extends ContractRecommendation {
  predictionSource: "llm";
  reasoning: string;
  confidenceLevel: "high" | "medium" | "low";
  questionTypeRecommendation: "views" | "likes";
}

// Narrow in UI:
const llmContract = "predictionSource" in contract
  ? (contract as LLMContractRecommendation)
  : null;
```

> ⚠️ **Superseded:** The percentile-framing approach below has been replaced. The current system prompt uses explicit multipliers (1.5–2×) over algorithmic projections — no percentile framing. See [`docs/solutions/logic-errors/llm-contract-calibration-bias-fix.md`](../logic-errors/llm-contract-calibration-bias-fix.md) for the updated approach.

### 10. Prompt Engineering for Median (Not Mean) Calibration

LLMs anchor to the mean by default. Four techniques combined to get the 50th percentile:

1. **Explicit framing**: "Set `milestoneThreshold` at the MEDIAN (50th percentile), NOT the mean."
2. **Distribution-first reasoning**: Ask the model to estimate 20th and 80th percentile bounds first, then extract the midpoint — anchors reasoning to the center of the distribution.
3. **Role framing**: "You are a calibrated forecaster" — prompts more conservative, well-reasoned estimates rather than optimistic projections.
4. **Explicit outlier suppression**: "Ignore viral top 10% of outcomes when setting the threshold."

## `export const maxDuration` for Vercel

Server Actions inherit their timeout from the page's [Route Segment Config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config). Without it, Vercel defaults apply (~10s Hobby). Add to the page file (not the action file):

```typescript
// src/app/admin/markets/new/page.tsx
"use client";

export const maxDuration = 30; // 4× headroom over expected ~7s happy path
```

## Error Classification Pattern

Log before rethrowing so the caller's catch block stays clean:

```typescript
} catch (err) {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("[llm:CRITICAL] Auth failed — check ANTHROPIC_API_KEY", err.message);
  } else if (err instanceof Anthropic.RateLimitError) {
    console.warn("[llm:ratelimit]", err.headers?.get?.("retry-after"));
  } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
    console.warn("[llm:timeout] 7.5s budget exceeded");
  } else if (err instanceof Anthropic.APIError && err.status >= 500) {
    console.warn(`[llm:server-error] ${err.status}`);
  } else {
    console.warn("[llm:fallback]", err instanceof Error ? err.message : String(err));
  }
  throw err; // caller handles fallback
}
```

---

## Prevention Strategies

### 1. Module-Level SDK Initialization
**Watch for:** Never instantiate SDK clients at module scope when a missing env var should trigger a fallback — defer construction to inside a function.
**Code review tip:** Grep for `new Anthropic(` (or any external SDK constructor) outside of function bodies. Flag top-level `const client = new SomeSDK()`.

### 2. Wrong Fallback Signature
**Watch for:** Every fallback call site must be verified against the actual function signature — fallback paths are rarely exercised in happy-path dev and drift silently.
**Code review tip:** When reviewing a catch branch, immediately open the called function's definition and compare argument count, order, and types.
**Test:** Write a unit test that deliberately triggers the fallback branch and asserts on the return value's shape.

### 3. Double API Call on Form Submit
**Watch for:** Server actions should be leaf nodes — extract shared logic into plain async utilities called by both actions independently.
**Code review tip:** Scan `"use server"` files for imports of other server action modules. Any server action calling another is a red flag.
**Test:** Intercept outbound HTTP calls (e.g., `msw`) and assert exactly one call per user action.

### 4. AbortController vs SDK-Native Timeout
**Watch for:** When an SDK exposes `timeout` + `maxRetries` options, always use those — they're tested against the SDK's own streaming internals.
**Code review tip:** Flag `new AbortController()` used alongside SDK streaming calls. Check the SDK's types first.

### 5. TypeScript `Headers` Bracket Access
**Watch for:** `Headers` has no index signature — always use `.get(name)`.
**Code review tip:** Search for `?.["` on variables typed as `Headers` or `Response`. Enable `tsc --noEmit` in CI.

### 6. Double-Fetch Race Condition
**Watch for:** Any async event handler that calls a server action and updates state needs a stale-check guard.
**Code review tip:** Look for `setState` inside an `await` without an ignore flag or stale check.
**Test:** Fire the action twice in rapid succession, resolve in reverse order, assert final state reflects the second call.

---

## Related Docs

- [`docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md`](./youtube-data-api-analytics-contract-generation.md) — YouTube API `fields` filter gotchas, original algorithmic contract system, controlled input migration
- [`docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`](../database-issues/nextjs-financial-app-code-review-patterns.md) — TOCTOU, LMSR server action patterns, financial state machine safety
- [`docs/plans/2026-03-22-002-feat-llm-autofill-contract-prediction-plan.md`](../../plans/2026-03-22-002-feat-llm-autofill-contract-prediction-plan.md) — full deepened implementation plan with architecture diagram and phase breakdown
