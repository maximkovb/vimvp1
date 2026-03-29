---
title: "feat: Proportional Milestone & Resolution Controls"
type: feat
status: completed
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md
---

# feat: Proportional Milestone & Resolution Controls

## Overview

Replace the plain `milestoneThreshold` number input and `resolutionHours` select in the market creation form with a **slider** and **pill option buttons** that are bidirectionally linked: adjusting one proportionally recalculates the other relative to the original AI recommendation anchor.

## Problem Statement / Motivation

Admins editing AI-suggested contract parameters have no affordance for proportional adjustment. Changing the view target manually gives no feedback on what a "fair" resolution window would be for that target, leading to inconsistently calibrated markets. The desired UX: drag the milestone slider → resolution snaps proportionally; click a different time window → milestone recalculates proportionally.

## Proposed Solution

1. Store the AI recommendation as an immutable **anchor** (`anchorMilestone`, `anchorHours`) when the video fetch completes.
2. Replace the `milestoneThreshold` number input with an `<input type="range">` slider. Range: `[0.1× anchor, 5× anchor]`. Displays current value as a formatted integer label.
3. Replace the `resolutionHours` select with four styled pill buttons: **24h / 48h / 72h / 7d**.
4. Moving the slider recalculates proportional hours and snaps to the nearest preset (`Math.round` + linear-distance snap).
5. Clicking a preset recalculates the milestone proportionally from the anchor, clamped to the slider range.
6. Both values are submitted via `<input type="hidden">` elements.

## Technical Considerations

- **No UI library**: the project uses hand-rolled Tailwind v4. Slider and pill buttons are new primitives — no shadcn/Radix available.
- **Tailwind v4**: uses `@theme inline` CSS variables (no `tailwind.config.js`). Arbitrary variant syntax (`[&::-webkit-slider-thumb]:...`) required to style the range input track/thumb, or add rules directly in `globals.css`.
- **Controlled state**: all four form fields (`milestoneThreshold`, `resolutionHours`, `bParameter`, `questionType`) are already controlled state. Anchor state follows the same pattern.
- **Form data**: `createMarket(formData)` reads fields by `name`. Pill buttons are `<button type="button">` (not form elements) so `resolutionHours` must be backed by `<input type="hidden" name="resolutionHours" value={resolutionHours}>`. Same for `milestoneThreshold` — a hidden input is cleaner than relying on a range input's `name` attribute.
- **Cancellation token**: the existing `useRef` cancellation token already guards stale fetch responses. Anchor resets must be added to the synchronous pre-`await` reset block.

## System-Wide Impact

- **Single file change**: only `src/app/admin/markets/new/page.tsx` changes. No server action, schema, or API changes required.
- **Submit gating**: adding `!anchorMilestone` to the Create Market button's `disabled` condition ensures the admin cannot submit when no anchor is set (e.g., when `contract: null` is returned).
- **Removed HTML `required` attribute**: replacing `<input type="number" required>` with a hidden input removes browser-native required validation. The server-side `CreateMarketSchema` in `admin.ts` already validates `milestoneThreshold` (`.int().min(1)`) — this is the authoritative guard.
- **No regression to `bParameter`**: `bParameter` remains a plain controlled number input and is completely untouched.

## Acceptance Criteria

- [ ] Slider and option buttons are disabled when `anchorMilestone` is null (before fetch or when `contract: null`)
- [ ] After a successful video fetch with AI contract, slider initializes at the exact anchor value and the matching preset button is selected
- [ ] Dragging the slider updates the formatted milestone label and snaps `resolutionHours` to the nearest preset (linear distance; ties go to the shorter window)
- [ ] Clicking a preset button recalculates `milestoneThreshold` as `Math.round(anchorMilestone × newHours / anchorHours)`, clamped to `[0.1×, 5×]` anchor range
- [ ] `milestoneThreshold` and `resolutionHours` submitted to `createMarket` match the displayed values
- [ ] A second Fetch resets both anchor values and both controls synchronously before the `await`
- [ ] Create Market button is disabled when `anchorMilestone` is null (in addition to `!videoPreview`)
- [ ] Slider and pill buttons are visually consistent with the dark Tailwind theme (accent color, disabled opacity)
- [ ] `bParameter`, `questionType`, title, description, and publish checkbox are unaffected

## Implementation Guide

### Step 1 — Add anchor state

In `page.tsx`, add two new state variables after the existing contract fields block (line 56):

```ts
// src/app/admin/markets/new/page.tsx
const [anchorMilestone, setAnchorMilestone] = useState<number | null>(null);
const [anchorHours, setAnchorHours] = useState<number | null>(null);
```

### Step 2 — Reset anchors in `handleFetchVideo`

In the synchronous pre-`await` reset block (lines 70–77), add:

```ts
setAnchorMilestone(null);
setAnchorHours(null);
```

### Step 3 — Seed anchors when AI recommendation loads

In the `if (result.contract)` block (lines 92–100), add after the existing `set*` calls:

```ts
setAnchorMilestone(result.contract.milestoneThreshold);
setAnchorHours(result.contract.resolutionHours);
```

### Step 4 — Add pure helper functions (module scope, above the component)

```ts
// src/app/admin/markets/new/page.tsx (above CreateMarketPage)

const RESOLUTION_PRESETS = [24, 48, 72, 168] as const;

/** Snap proportional hours to the nearest resolution preset (linear distance). Ties go to shorter. */
function snapToPreset(hours: number): string {
  return String(
    RESOLUTION_PRESETS.reduce((best, preset) =>
      Math.abs(preset - hours) < Math.abs(best - hours) ? preset : best
    )
  );
}

/** Step size for the milestone slider: 1/100th of anchor's order of magnitude. Min 1. */
function computeStep(anchor: number): number {
  return Math.max(1, Math.pow(10, Math.floor(Math.log10(anchor)) - 1));
}
```

### Step 5 — Add change handlers (inside the component)

```ts
// src/app/admin/markets/new/page.tsx (inside CreateMarketPage, before the JSX)

function handleMilestoneSlider(rawValue: string) {
  const value = Math.round(Number(rawValue));
  setMilestoneThreshold(String(value));
  if (anchorMilestone && anchorHours) {
    setResolutionHours(snapToPreset(anchorHours * (value / anchorMilestone)));
  }
}

function handleResolutionButton(hours: number) {
  setResolutionHours(String(hours));
  if (anchorMilestone && anchorHours) {
    const min = Math.round(anchorMilestone * 0.1);
    const max = Math.round(anchorMilestone * 5);
    const raw = Math.round(anchorMilestone * (hours / anchorHours));
    setMilestoneThreshold(String(Math.max(min, Math.min(max, raw))));
  }
}
```

### Step 6 — Replace milestone number input (lines 279–293 in page.tsx)

Replace the `<div>` block containing `<input type="number" name="milestoneThreshold" ...>` with:

```tsx
<div>
  <label className="block text-sm font-medium mb-1.5">
    Milestone Target
  </label>
  <input type="hidden" name="milestoneThreshold" value={milestoneThreshold} />
  <div className="space-y-2">
    <div className="flex justify-between text-xs text-muted">
      <span>
        {anchorMilestone
          ? Math.round(anchorMilestone * 0.1).toLocaleString()
          : "–"}
      </span>
      <span className="text-sm font-semibold text-foreground">
        {milestoneThreshold
          ? Number(milestoneThreshold).toLocaleString()
          : "–"}
      </span>
      <span>
        {anchorMilestone
          ? Math.round(anchorMilestone * 5).toLocaleString()
          : "–"}
      </span>
    </div>
    <input
      type="range"
      disabled={!anchorMilestone}
      min={anchorMilestone ? Math.round(anchorMilestone * 0.1) : 0}
      max={anchorMilestone ? Math.round(anchorMilestone * 5) : 100}
      step={anchorMilestone ? computeStep(anchorMilestone) : 1}
      value={milestoneThreshold || "0"}
      onChange={(e) => handleMilestoneSlider(e.target.value)}
      className="w-full disabled:opacity-40 cursor-pointer"
    />
  </div>
</div>
```

### Step 7 — Replace resolution select (lines 297–314 in page.tsx)

Replace the `<div>` block containing `<select name="resolutionHours" ...>` with:

```tsx
<div>
  <label className="block text-sm font-medium mb-1.5">
    Resolution Window
  </label>
  <input type="hidden" name="resolutionHours" value={resolutionHours} />
  <div className="flex gap-2">
    {(
      [
        ["24", "24h"],
        ["48", "48h"],
        ["72", "72h"],
        ["168", "7d"],
      ] as const
    ).map(([value, label]) => (
      <button
        key={value}
        type="button"
        disabled={!anchorMilestone}
        onClick={() => handleResolutionButton(Number(value))}
        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 ${
          resolutionHours === value
            ? "bg-accent text-white"
            : "bg-accent/10 text-accent hover:bg-accent/20"
        }`}
      >
        {label}
      </button>
    ))}
  </div>
</div>
```

### Step 8 — Update submit button disabled condition

Change the existing button at the bottom (line 350–356):

```tsx
// Before
disabled={isPending || !videoPreview}

// After
disabled={isPending || !videoPreview || !anchorMilestone}
```

### Step 9 — Style the range input

Add to `src/app/globals.css` (below the existing `:root`/`@theme` blocks):

```css
/* Slider styling */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 9999px;
  background: var(--color-border);
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
}
input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: none;
}
input[type="range"]:disabled::-webkit-slider-thumb {
  background: var(--color-muted);
  cursor: not-allowed;
}
input[type="range"]:disabled::-moz-range-thumb {
  background: var(--color-muted);
  cursor: not-allowed;
}
```

The variable names above (`var(--color-accent)`, `var(--color-border)`, `var(--color-muted)`) are confirmed correct from `src/app/globals.css` — the `@theme inline` block defines them exactly.

## Dependencies & Risks

- **Next.js 16 breaking changes**: AGENTS.md warns this version has breaking API changes. No `<form action={serverAction}>` syntax is used here — only the existing `onSubmit` + `FormData` pattern — so no risk from this change.
- **`contract: null` UX gap**: if `fetchVideoMetadata` returns a valid video but `contract: null` (analytics failure), the controls remain permanently disabled and the admin cannot create a market. This is a pre-existing limitation, not introduced by this feature, but it becomes more visible. A follow-up could add a "manual entry" fallback for this state.

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md](../brainstorms/2026-03-23-market-creation-proportional-controls-requirements.md)
  - Key decisions carried forward: linear ratio scaling from AI anchor; snap to nearest preset on slider drag; `Math.round` for all proportional calculations

### Internal References
- Market creation form: `src/app/admin/markets/new/page.tsx` (full file — single component)
- `roundToClean` helper (reference only): `src/lib/contract.ts:92`
- Resolution preset type: `src/lib/contract.ts:9` — `resolutionHours: 24 | 48 | 72 | 168`
- `createMarket` field parsing: `src/lib/actions/admin.ts:250–278`
- Pill button pattern reference: `src/components/TradePanel.tsx:81–102`
- Global CSS tokens: `src/app/globals.css` (verify CSS variable names before writing slider styles)
- Existing solutions: `docs/solutions/integration-issues/youtube-data-api-analytics-contract-generation.md` — controlled inputs + cancellation token pattern (already followed in this impl)
