---
title: "feat: Quick Create — editable contract title in video preview"
type: feat
status: active
date: 2026-03-29
---

# feat: Quick Create — editable contract title in video preview

## Overview

The quick-create form currently stores the raw YouTube video title verbatim as
`markets.title`. This means every market created via quick-create has a title like
*"MrBeast - I Spent 50 Hours In Ice"* rather than a proper prediction-market question
like *"Will this hit 10M views in 48h?"*.

Add a dedicated **Contract Title** input that appears in the Step 1 video preview card
(beside the thumbnail), pre-filled from the video title but freely editable. This value
becomes `markets.title`. The video title stays visible in the preview purely as context.

## Problem Statement / Motivation

- `markets.title` is the string shown to end users on the market list and market page.
  A raw YouTube title is not a prediction-market question.
- The full creation form (Step 2 AI pipeline) already produces a good contract title via
  LLM. Quick-create bypasses the AI, so the admin must supply one manually.
- Requiring the admin to navigate to the market detail after creation just to fix the title
  is friction. A visible, editable field at creation time is better.

## Proposed Solution

1. Add `contractTitle: string` state to `quick/page.tsx`, pre-populated with
   `videoStats.title` when the Fetch step completes.
2. Render an editable `<input>` for the contract title **inside the Step 1 video preview
   card**, directly below the video title/channel row — so it's clearly visible next to the
   thumbnail.
3. Add `contractTitle` to the `canCreate` guard (non-empty required).
4. Pass `contractTitle` as a fourth argument to `createTestMarket`.
5. Update `createTestMarket` in `admin.ts` to accept `contractTitle: string` and use it as
   `markets.title` instead of `videoStats.title`.

The video title continues to be stored in `videoMetadata.title` (unchanged), so the market
detail page can still display the original video context.

## Technical Considerations

- **`createTestMarket` signature change** — add `contractTitle: string` as the fourth
  parameter. All existing callers are only `quick/page.tsx`, so no other call sites to
  update.
- **Validation** — `contractTitle.trim()` must be non-empty before the Create button is
  enabled. No length cap imposed here (the DB column is `text`, no constraint).
- **Pre-fill timing** — set `contractTitle` inside the `else` branch of the `handleFetch`
  success path (same place `setVideoStats(result)` is called), using `result.title`. Reset
  it to `""` in the pre-fetch reset block alongside `setVideoStats(null)`.
- **No DB migration** — `markets.title` already exists as `text NOT NULL`; no schema change.

## Acceptance Criteria

- [ ] After a successful Fetch, the Step 1 preview card shows an editable "Contract title"
      input pre-filled with the video's title, placed visibly near the thumbnail
- [ ] The admin can edit the contract title freely; the video title in the preview row is
      unchanged (read-only display)
- [ ] The Create button is disabled when `contractTitle.trim()` is empty
- [ ] A market created via quick-create has `markets.title` equal to the (edited) contract
      title, not the raw YouTube video title
- [ ] `videoMetadata.title` is unaffected (still stores the YouTube video title)
- [ ] Resetting (re-fetching a new URL) clears the contract title field
- [ ] No TypeScript build errors

## Implementation Steps

### Step 1 — Update `src/app/admin/markets/quick/page.tsx`

```tsx
// New state (add alongside existing state declarations)
const [contractTitle, setContractTitle] = useState("");

// In handleFetch — pre-fetch reset block (alongside setVideoStats(null)):
setContractTitle("");

// In handleFetch — success branch (alongside setVideoStats(result)):
setContractTitle(result.title);

// In handleCreate — pass contractTitle as 4th arg:
const result = await createTestMarket(videoUrl.trim(), milestoneNum, questionType, contractTitle.trim());

// canCreate guard — add contractTitle check:
const canCreate = !!videoStats && !!milestone && parseFloat(milestone) >= 1
  && contractTitle.trim().length > 0 && !isCreating;

// Inside the video preview card (after the title/channel/counts div):
<div className="mt-2">
  <label className="block text-xs text-muted mb-1">Contract title</label>
  <input
    type="text"
    value={contractTitle}
    onChange={(e) => setContractTitle(e.target.value)}
    placeholder="e.g. Will this hit 1M views in 48h?"
    className="w-full px-2 py-1.5 bg-card border border-border rounded text-sm
               focus:outline-none focus:ring-2 focus:ring-accent"
  />
</div>
```

### Step 2 — Update `createTestMarket` in `src/lib/actions/admin.ts`

```ts
export async function createTestMarket(
  videoUrl: string,
  milestoneThreshold: number,
  questionType: "views" | "likes",
  contractTitle: string,            // ← new parameter
)

// In the db.transaction INSERT:
// Replace: title: videoData.title  (or however the video title was used)
// With:    title: contractTitle.trim()
```

## Sources & References

- Quick-create page: `src/app/admin/markets/quick/page.tsx`
- Server action to update: `src/lib/actions/admin.ts` — `createTestMarket` (~line 396)
- DB schema (no change needed): `src/db/schema.ts` — `markets.title text NOT NULL`
- Full creation form for reference (contract title input pattern):
  `src/app/admin/markets/new/page.tsx` (~line 373)
