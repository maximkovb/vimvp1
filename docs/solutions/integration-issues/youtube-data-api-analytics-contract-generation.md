---
title: "YouTube Data API analytics integration for risk-tiered contract generation"
category: integration-issues
date: 2026-03-22
tags:
  - next.js
  - youtube-api
  - contract-parameters
  - risk-analysis
  - server-actions
  - lmsr
---

# YouTube Data API analytics integration for risk-tiered contract generation

## Problem Description

When extending `fetchVideoMetadata` to also return risk-tiered contract recommendations, the YouTube API `fields` filter silently returns partial data — `channelId` and `publishedAt` were missing from the snippet projection because the original filter string did not include them. The API returns HTTP 200 with whatever fields matched, so there is no error to catch; the properties simply come back `undefined` and downstream code fails unexpectedly.

Separately, the admin create-market form had three uncontrolled HTML inputs (`milestoneThreshold`, `bParameter`, `resolutionHours`) that could not be auto-populated from server data — React does not support setting uncontrolled input values after mount.

## Root Cause

1. **Silent partial response from YouTube API `fields` filter** — The original `videos` call used a `fields` parameter that only projected `snippet(title,thumbnails/medium/url,channelTitle)`. Adding channel analytics requires `channelId` and `publishedAt` from the same snippet, but these were not in the filter. The API silently omits unfiltered fields with a 200 response.

2. **Uncontrolled inputs cannot be auto-populated** — The three contract-related form fields had only `name` attributes and no React state. Setting them from a server action result requires converting them to controlled inputs with `useState`.

## Solution

### 1. Pure contract logic module (`src/lib/contract.ts`)

All risk logic lives in a dedicated module with no side effects. This separation allows independent testing and keeps the server action clean.

```typescript
export type RiskTier = "low" | "medium" | "high";

export interface ContractRecommendation {
  riskTier: RiskTier;
  milestoneThreshold: number;
  bParameter: number;
  resolutionHours: 24 | 48 | 72 | 168;  // must match <select> options
}

export function calculateConfidence(
  videoAgeHours: number,
  recentViewCounts: number[]
): number {
  let varianceScore = 0.5;
  if (recentViewCounts.length > 1) {
    const mean = recentViewCounts.reduce((acc, v) => acc + v, 0) / recentViewCounts.length;
    if (mean > 0) {
      const variance = recentViewCounts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / recentViewCounts.length;
      varianceScore = Math.min(1, Math.max(0, 1 - Math.sqrt(variance) / mean));
    }
  }
  const ageScore = videoAgeHours >= 2 && videoAgeHours <= 12 ? 1 : 0.6;
  return Math.round(varianceScore * ageScore * 100);
}

export function assignRiskTier(confidence: number): RiskTier {
  if (confidence >= 70) return "low";
  if (confidence >= 40) return "medium";
  return "high";
}
```

Confidence is `varianceScore × ageScore × 100`. `varianceScore` is `1 − (stdDev / mean)` of recent video view counts (lower coefficient of variation = more consistent channel = higher score). `ageScore` peaks at 1.0 for videos 2–12h old (optimal velocity window) and drops to 0.6 otherwise.

> ⚠️ **Superseded:** The table below is the original baseline and is no longer used. The current approach uses `resolveWindow()` for resolution hours and 2.0×/1.5×/1.2× multipliers on algorithmic projections per tier. See [`docs/solutions/logic-errors/llm-contract-calibration-bias-fix.md`](../logic-errors/llm-contract-calibration-bias-fix.md).

Contract calibration by tier (original baseline — superseded):
| Tier | b | resolutionHours | milestoneThreshold |
|------|---|----------------|--------------------|
| Low  | 75 | 48 | raw log projection |
| Medium | 100 | 72 | 60% projection + 40% avg views |
| High | 150 | 72 | 80% of medium formula |

### 2. Fix the YouTube API `fields` filter and extend `fetchVideoMetadata`

**Critical:** Update the `fields` string on the `videos` call to include `channelId` and `publishedAt`:

```typescript
// BEFORE (missing channelId and publishedAt):
`fields=items(id,snippet(title,thumbnails/medium/url,channelTitle),statistics(viewCount,likeCount))`

// AFTER:
`fields=items(id,snippet(title,thumbnails/medium/url,channelTitle,channelId,publishedAt),statistics(viewCount,likeCount))`
```

Add channel analytics in parallel after the video fetch, wrapped in try/catch for graceful fallback:

```typescript
let contract: ContractRecommendation | null = null;
try {
  const channelId: string = item.snippet.channelId;
  const videoAgeHours = (Date.now() - new Date(item.snippet.publishedAt).getTime()) / 3_600_000;

  const [channelRes, searchRes] = await Promise.all([
    fetch(`${YOUTUBE_API_BASE}/channels?part=statistics&id=${channelId}&key=${apiKey}&fields=items(statistics/subscriberCount)`, { cache: "no-store" }),
    fetch(`${YOUTUBE_API_BASE}/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=10&key=${apiKey}`, { cache: "no-store" }),
  ]);

  let recentViewCounts: number[] = [];
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    const recentVideoIds: string[] = (searchData.items ?? [])
      .map((v: { id: { videoId: string } }) => v.id.videoId)
      .filter(Boolean);

    if (recentVideoIds.length > 0) {
      const statsRes = await fetch(
        `${YOUTUBE_API_BASE}/videos?part=statistics&id=${recentVideoIds.join(",")}&key=${apiKey}&fields=items(statistics/viewCount)`,
        { cache: "no-store" }
      );
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        recentViewCounts = (statsData.items ?? []).map(
          (v: { statistics: { viewCount?: string } }) =>
            parseInt(v.statistics.viewCount || "0")
        );
      }
    }
  }

  const confidence = calculateConfidence(videoAgeHours, recentViewCounts);
  contract = calculateContractRecommendations(confidence, viewCount, videoAgeHours, recentViewCounts);
} catch {
  // Analytics failed — contract stays null; UI uses static defaults.
}

return { videoId, title, thumbnail, channelTitle, viewCount, likeCount, contract };
```

### 3. Convert form inputs to controlled and add the RiskBadge

```typescript
const [milestoneThreshold, setMilestoneThreshold] = useState("");
const [bParameter, setBParameter] = useState("100");
const [resolutionHours, setResolutionHours] = useState("72");
const [riskTier, setRiskTier] = useState<RiskTier | null>(null);

async function handleFetchVideo() {
  // Reset before fetch so stale values from a previous URL don't linger.
  setError("");
  setVideoPreview(null);
  setRiskTier(null);
  setMilestoneThreshold("");
  setBParameter("100");
  setResolutionHours("72");
  if (!videoUrl) return;

  const result = await fetchVideoMetadata(videoUrl);
  if ("error" in result) {
    setError(result.error ?? "Unknown error");
  } else {
    setVideoPreview(result);
    if (result.contract) {
      setMilestoneThreshold(String(result.contract.milestoneThreshold));
      setBParameter(String(result.contract.bParameter));
      setResolutionHours(String(result.contract.resolutionHours));
      setRiskTier(result.contract.riskTier);
    }
  }
}
```

The `<select>` for `resolutionHours` must use `value={resolutionHours}` (not the HTML `selected` attribute on `<option>`). All three inputs keep their `name` attributes so `FormData` still reads them correctly at submit — controlled inputs participate in form submission normally.

`RiskBadge` is a local component in the page file (no new files needed):

```tsx
const RISK_BADGE_STYLES: Record<RiskTier, string> = {
  low:    "bg-green-500/10 text-green-600 border border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20",
  high:   "bg-red-500/10 text-red-600 border border-red-500/20",
};
```

## Files Changed

| File | Change |
|------|--------|
| `src/lib/contract.ts` | New — pure risk/contract functions, no side effects |
| `src/lib/actions/admin.ts` | Extended `fetchVideoMetadata` with analytics; fixed `fields` filter |
| `src/app/admin/markets/new/page.tsx` | Controlled inputs, `RiskBadge`, reset-on-refetch |

No DB migrations. `createMarket` is unchanged — it already reads all three fields from `FormData`.

## Prevention

### YouTube API `fields` filter checklist

- **Always test for `undefined` on snippet fields after any `fields` change** — add a log or assertion after the video fetch in development: `if (!item.snippet.channelId) throw new Error("channelId missing from API response")`.
- **When adding new snippet fields, update the `fields` parameter first**, not after. The API will not warn you; it returns 200 with partial data every time.
- **Grep the field string before any future YouTube API calls**: `grep -r "fields=" src/lib/actions/admin.ts` to find all projection strings.

### YouTube API `fields` parameters to include for this integration

For the `videos` endpoint when channel analytics are needed:
```
fields=items(id,snippet(title,thumbnails/medium/url,channelTitle,channelId,publishedAt),statistics(viewCount,likeCount))
```

### React uncontrolled → controlled migration pattern

When a form input needs to be auto-populated from async data:
1. Add `useState` for the field with the same default the HTML previously had.
2. Add `value` + `onChange` to the element.
3. Keep the `name` attribute — `FormData` still works.
4. Reset state at the **start** of the async handler (before `await`), not after — this prevents stale values if the user cancels or the fetch takes a long time.

### Test scenarios for `src/lib/contract.ts`

```typescript
// calculateConfidence
test("returns 50 * ageScore with no data", () => {
  expect(calculateConfidence(5, [])).toBe(50);        // age=5h → ageScore=1.0 → 50
  expect(calculateConfidence(1, [])).toBe(30);        // age=1h → ageScore=0.6 → 30
});

test("uniform views → varianceScore=1, low variance channel", () => {
  const counts = [1000, 1000, 1000, 1000];
  expect(calculateConfidence(5, counts)).toBe(100);   // stdDev=0 → varianceScore=1
});

test("high variance channel scores lower", () => {
  const uniform = [1000, 1000, 1000, 1000];
  const chaotic = [100, 5000, 200, 8000];
  expect(calculateConfidence(5, uniform)).toBeGreaterThan(calculateConfidence(5, chaotic));
});

// assignRiskTier
test("tier boundaries are inclusive at 70 and 40", () => {
  expect(assignRiskTier(70)).toBe("low");
  expect(assignRiskTier(69)).toBe("medium");
  expect(assignRiskTier(40)).toBe("medium");
  expect(assignRiskTier(39)).toBe("high");
});

// calculateContractRecommendations
test("low tier returns b=75 and 48h window", () => {
  const rec = calculateContractRecommendations(80, 500_000, 5, [400_000, 500_000, 450_000]);
  expect(rec.bParameter).toBe(75);
  expect(rec.resolutionHours).toBe(48);
});

test("high tier returns b=150 and conservative milestone", () => {
  const medium = calculateContractRecommendations(50, 100_000, 5, [80_000, 120_000]);
  const high   = calculateContractRecommendations(20, 100_000, 5, [80_000, 120_000]);
  expect(high.bParameter).toBe(150);
  expect(high.milestoneThreshold).toBeLessThan(medium.milestoneThreshold);
});
```

## Related

- `src/lib/lmsr.ts` — `bParameter` usage in LMSR pricing math
- `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — general server action patterns
- `docs/solutions/integration-issues/drizzle-kit-env-local-configuration.md` — environment variable patterns for API keys
- **Open risk**: `todos/012-complete-p2-fetchvideometadata-unauthenticated.md` — `fetchVideoMetadata` makes 3+ YouTube API calls with the admin's API key without gating on authentication early enough in the call chain. This was a pre-existing issue that the analytics extension exacerbates (more quota exposed per unauthenticated call). Address after fixing todo 011 (admin auth hardening).

## Post-Deploy Monitoring

- **Watch for markets with `bParameter = 100` consistently** — if all markets still land on 100, analytics are silently returning `contract: null`. Check server logs for caught analytics exceptions.
- **Verify risk badge appears** — manually fetch a YouTube URL in the admin create-market form and confirm the badge renders.
- **YouTube API quota** — each admin fetch now costs ~3–4 quota units (video + channel + search + batch stats). Monitor the YouTube API console for quota spikes if admin usage increases.
- **Calibration baseline** — the initial b=75/100/150 and 48/72h values are untested starting points. After ~20 markets, compare resolved outcomes by tier to assess whether thresholds need adjustment.
