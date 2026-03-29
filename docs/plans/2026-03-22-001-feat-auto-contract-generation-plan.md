---
title: "feat: Auto-generate risk-tiered contract terms on market creation"
type: feat
status: completed
date: 2026-03-22
origin: docs/brainstorms/2026-03-22-auto-contract-generation-requirements.md
---

# feat: Auto-generate risk-tiered contract terms on market creation

## Overview

When an admin fetches YouTube video metadata to create a market, the `milestoneThreshold`, `bParameter`, and `resolutionHours` fields are filled with static defaults (b=100, 72h). This plan adds channel analytics to the fetch step, computes a risk tier (Low/Medium/High) from those analytics, and auto-populates the existing form fields with risk-adjusted recommendations. Admins can override any value before creating. No new form fields are added — the existing inputs just get smarter defaults.

## Problem Statement

- `bParameter` defaults to 100 for every market regardless of channel predictability.
- `resolutionHours` defaults to 72h regardless of whether the outcome is obvious or highly uncertain.
- `milestoneThreshold` is set entirely by hand with no analytical guidance.
- The admin has no signal about risk when creating a market, and no way to know what values are appropriate.

## Proposed Solution

1. Add a new `src/lib/contract.ts` module with pure functions: `assignRiskTier()` and `calculateContractRecommendations()`.
2. Extend `fetchVideoMetadata` in `src/lib/actions/admin.ts` to also fetch channel subscriber count and recent video view counts. Compute and return a `contract` object alongside the existing video preview data.
3. Update `src/app/admin/markets/new/page.tsx` to consume the `contract` response: convert the three contract-related inputs to controlled inputs, auto-populate them from `contract`, and show a risk tier badge next to the video preview.

## Technical Considerations

### New Module: `src/lib/contract.ts`

All risk logic lives here as pure functions with no side effects. No YouTube API calls, no DB access.

```typescript
export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  riskTier: RiskTier;
  milestoneThreshold: number;    // view/like count target
  bParameter: number;            // LMSR liquidity parameter
  resolutionHours: 24 | 48 | 72 | 168;  // must match the select options
}

/** Maps confidence score (0–100) → risk tier */
export function assignRiskTier(confidence: number): RiskTier {
  if (confidence >= 70) return "low";
  if (confidence >= 40) return "medium";
  return "high";
}

/**
 * Confidence score: how consistent and mature is this channel/video?
 * Returns integer 0–100.
 *
 * Factors:
 * - varianceScore: coefficient of variation of recent view counts (lower CV = higher score)
 * - ageScore: 1.0 if video is 2–12h old; 0.6 otherwise (more data is better but very old videos are ineligible)
 */
export function calculateConfidence(
  videoAgeHours: number,
  recentViewCounts: number[]
): number {
  let varianceScore = 0.5; // default if no data
  if (recentViewCounts.length > 1) {
    const mean = recentViewCounts.reduce((a, b) => a + b, 0) / recentViewCounts.length;
    if (mean > 0) {
      const variance = recentViewCounts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / recentViewCounts.length;
      const stdDev = Math.sqrt(variance);
      varianceScore = Math.min(1, Math.max(0, 1 - stdDev / mean));
    }
  }
  const ageScore = videoAgeHours >= 2 && videoAgeHours <= 12 ? 1 : 0.6;
  return Math.round(varianceScore * ageScore * 100);
}

/**
 * Round to a clean milestone number (e.g. 47,200 → 50,000).
 */
function roundToClean(value: number): number {
  if (value < 10_000)  return Math.round(value / 1_000) * 1_000;
  if (value < 100_000) return Math.round(value / 5_000) * 5_000;
  if (value < 500_000) return Math.round(value / 10_000) * 10_000;
  if (value < 2_000_000) return Math.round(value / 50_000) * 50_000;
  return Math.round(value / 100_000) * 100_000;
}

export function calculateContractRecommendations(
  confidence: number,
  currentViews: number,
  videoAgeHours: number,
  recentViewCounts: number[]
): ContractRecommendation {
  const tier = assignRiskTier(confidence);

  // Baseline projection: logarithmic growth from current velocity
  const safeAge = Math.max(videoAgeHours, 0.1);
  const projected = Math.round(currentViews * (Math.log(72 + 1) / Math.log(safeAge + 1)));
  const avgViews = recentViewCounts.length > 0
    ? recentViewCounts.reduce((a, b) => a + b, 0) / recentViewCounts.length
    : currentViews;

  switch (tier) {
    case "low":
      return {
        riskTier: tier,
        milestoneThreshold: roundToClean(projected),         // aggressive: raw projection
        bParameter: 75,                                      // lower liquidity — outcome more certain
        resolutionHours: 48,                                 // shorter window — resolves faster
      };
    case "medium":
      return {
        riskTier: tier,
        milestoneThreshold: roundToClean(projected * 0.6 + avgViews * 0.4), // blended
        bParameter: 100,                                     // current default
        resolutionHours: 72,                                 // current default
      };
    case "high":
      return {
        riskTier: tier,
        milestoneThreshold: roundToClean((projected * 0.6 + avgViews * 0.4) * 0.8), // conservative
        bParameter: 150,                                     // more liquidity — attract trading despite uncertainty
        resolutionHours: 72,                                 // same as medium
      };
  }
}
```

### Extended `fetchVideoMetadata` in `src/lib/actions/admin.ts`

Add 2 additional YouTube API calls after the existing video fetch. Then compute and return `contract` alongside the video preview data.

**New return shape:**
```typescript
{
  videoId, title, thumbnail, channelTitle, viewCount, likeCount,  // existing
  contract: ContractRecommendation | null,  // null if channel analytics calls fail (graceful fallback)
}
```

**New YouTube API calls needed:**

⚠️ **Update the existing video API `fields` filter** — the current call fetches `snippet(title,thumbnails/medium/url,channelTitle)` but omits `publishedAt` and `channelId`. Both are needed. Update the fields string to:
```
fields=items(id,snippet(title,thumbnails/medium/url,channelTitle,channelId,publishedAt),statistics(viewCount,likeCount))
```

1. **Channel stats** — requires `channelId` from the video snippet. Then:
   ```
   GET /channels?part=statistics&id={channelId}&key={apiKey}&fields=items(statistics/subscriberCount)
   ```

2. **Recent videos with view counts** —
   ```
   GET /search?part=snippet&channelId={channelId}&type=video&order=date&maxResults=10&key={apiKey}
   ```
   Then batch fetch stats:
   ```
   GET /videos?part=statistics&id={videoIds}&key={apiKey}&fields=items(id,statistics/viewCount)
   ```

This triples YouTube API quota usage per fetch (acceptable for admin-only use).

**Compute and attach (wrap analytics in try/catch for graceful fallback):**
```typescript
import { calculateConfidence, calculateContractRecommendations } from "@/lib/contract";

let contract: ContractRecommendation | null = null;
try {
  const publishedAt = new Date(item.snippet.publishedAt);
  const videoAgeHours = (Date.now() - publishedAt.getTime()) / 3_600_000;
  const confidence = calculateConfidence(videoAgeHours, recentViewCounts);
  contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, recentViewCounts);
} catch {
  // analytics failed — contract stays null; UI falls back to static defaults
}

return { videoId, title, thumbnail, channelTitle, viewCount, likeCount, contract };
```

### Updated Admin Create Page (`src/app/admin/markets/new/page.tsx`)

**Three uncontrolled inputs become controlled.** The `milestoneThreshold`, `bParameter`, and `resolutionHours` inputs currently have no React state — they use HTML `name` attributes and FormData reads them at submit time. To auto-populate from the fetch result, add controlled state:

```typescript
const [milestoneThreshold, setMilestoneThreshold] = useState("");
const [bParameter, setBParameter] = useState("100");
const [resolutionHours, setResolutionHours] = useState("72");
const [riskTier, setRiskTier] = useState<"low" | "medium" | "high" | null>(null);

// In handleFetchVideo, after setVideoPreview(result):
if (result.contract) {
  setMilestoneThreshold(String(result.contract.milestoneThreshold));
  setBParameter(String(result.contract.bParameter));
  setResolutionHours(String(result.contract.resolutionHours));
  setRiskTier(result.contract.riskTier);
}
// If contract is null (analytics fallback), fields keep their current defaults (b=100, 72h, no badge)
```

Update the three `<input>`/`<select>` elements to be controlled (add `value` + `onChange`). The `<form>` `onSubmit` still uses `FormData` normally since controlled inputs are still `name`-attributed form elements.

**Risk badge** — add next to channel title in the video preview card:

```tsx
{videoPreview && riskTier && (
  <div className="flex gap-3 p-3 bg-card border border-border rounded-lg">
    ...existing preview content...
    <RiskBadge tier={riskTier} />
  </div>
)}
```

**Add `RiskBadge` as a local component:**

```tsx
const RISK_BADGE_STYLES = {
  low:    "bg-green-500/10 text-green-600 border border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20",
  high:   "bg-red-500/10 text-red-600 border border-red-500/20",
};
const RISK_LABELS = { low: "Low Risk", medium: "Medium Risk", high: "High Risk" };

function RiskBadge({ tier }: { tier: "low" | "medium" | "high" }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_BADGE_STYLES[tier]}`}>
      {RISK_LABELS[tier]}
    </span>
  );
}
```

**Reset on re-fetch** — `setRiskTier(null)` and reset the three fields at the start of `handleFetchVideo` (before the new result arrives), so stale values don't persist if a different URL is analyzed.

### Validation Note

The `resolutionHours` select has fixed options (24/48/72/168). `ContractRecommendation.resolutionHours` is typed as `24 | 48 | 72 | 168` to ensure auto-populated values always match an existing option. The server (`createMarket`) already defaults to 72h if the field is missing, so no server-side changes needed for validation.

No `haltsAt` / `resolvesAt` timing conflicts: `resolvesAt = now + resolutionHours` with no video-publish-time dependency — any of the four resolution options is always valid.

## Acceptance Criteria

- [ ] **R1** — A risk tier badge appears after a successful video fetch.
- [ ] **R2** — `milestoneThreshold`, `bParameter`, and `resolutionHours` are pre-filled per the calibration table above after fetch.
- [ ] **R3** — Pre-filled values appear in the existing form inputs, not a separate section.
- [ ] **R4** — Admin can edit any field after fetch; Create Market uses the final field values.
- [ ] **R5** — `fetchVideoMetadata` returns `contract: ContractRecommendation` alongside existing video data.
- [ ] Risk badge resets to null when a new URL is entered and Fetch is clicked.
- [ ] If the YouTube channel/search API calls fail, fall back gracefully — use static defaults (b=100, 72h) and omit the risk badge rather than failing the entire fetch.
- [ ] `src/lib/contract.ts` is pure (no API calls, no DB access, no side effects).

## Files to Create / Modify

| File | Change |
|---|---|
| `src/lib/contract.ts` | **New** — `assignRiskTier`, `calculateConfidence`, `calculateContractRecommendations`, `roundToClean`, `ContractRecommendation` type |
| `src/lib/actions/admin.ts` | Extend `fetchVideoMetadata` to fetch channel stats + recent video views; compute confidence + contract; add to return value |
| `src/app/admin/markets/new/page.tsx` | Convert 3 inputs to controlled; populate from fetch result; add `RiskBadge`; reset on re-fetch |

No DB migrations. No changes to `createMarket`. No new routes.

## Dependencies & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Channel analytics calls add ~2 extra YouTube API quota units per admin fetch | Low | Admin-only flow; low frequency |
| `channelId` and `publishedAt` not in existing `fields` filter | High | Update fields string to include `snippet/channelId` and `snippet/publishedAt` (see Technical Considerations) |
| Calibration values (b=75/100/150, 48/72h) are untested starting points | Medium | Monitor and adjust after deploy |
| `search` API call for recent videos is slower than `videos` call | Low | Runs in parallel with channel stats call |
| If fetch returns `contract` but UI state diverges (admin edited then re-fetched), state resets correctly only if reset is called at the start of `handleFetchVideo` | Low | Document and enforce in implementation |

## Success Metrics

- `bParameter` varies across newly created markets (no longer always 100).
- Admin sees a risk badge on every analyzed video.
- No increase in market creation errors from the extended fetch.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-22-auto-contract-generation-requirements.md](../brainstorms/2026-03-22-auto-contract-generation-requirements.md)
  - Key decisions carried forward: (1) contract = milestoneThreshold + bParameter + resolutionHours (see origin: R2), (2) risk tier driven by confidence score (see origin: R1), (3) auto-populate existing form fields rather than adding a new section (see origin: R3 + Scope Boundaries)

### Internal References

- `src/lib/actions/admin.ts` — `fetchVideoMetadata` server action to extend; `createMarket` (unchanged)
- `src/lib/lmsr.ts` — LMSR math; `bParameter` usage
- `src/app/admin/markets/new/page.tsx` — admin create form; existing field names and structure
- `src/db/schema.ts` — `markets` table; `bParameter decimal`, `milestoneThreshold bigint`, `resolvesAt timestamp`
