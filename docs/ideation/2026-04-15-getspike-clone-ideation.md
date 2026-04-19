---
date: 2026-04-15
topic: getspike-clone-ux-parity
focus: Clone getspike.app UX/UI refinements into the doomscroll-native layout while maintaining existing backend structure
---

# Ideation: getspike.app UX Parity

## Codebase Context

- **Stack**: Next.js 16.2.1 App Router, React 19, Tailwind CSS v4, Drizzle ORM + Neon Postgres, Vaul bottom sheets, LMSR market mechanic, play coins
- **Core UX**: Doomscroll vertical TikTok-style feed (mobile-first), market detail at `/markets/[id]`, ~30 components (FeedCard, BetSheet, TradePanel, PriceChart), IntersectionObserver video playback
- **Already built**: leaderboard, portfolio, history, profile, resolved markets, admin market creation pipeline
- **Constraint**: Keep doomscroll layout and existing backend structure. Collapse getspike features into the scroll UX natively where possible.
- **Competitor gap**: getspike.app ships: Advanced/Simple toggle, dense metrics grid (views/hr, engagement rate, virality rate, talkability, implied probabilities, YES/NO volume), AI "At Risk / On Track" projection label, expandable chart with red target line, real-time payout calculator, resolution rules accordion, comments section, brand footer.

## Ranked Ideas

### 1. Linear Progress Bar with YES/NO Volume Split
**Description:** Replace the circular indicator on FeedCard with a full-width horizontal bar. Fill encodes time-to-resolution (left → right). The fill is color-split: green = YES volume proportion, red = NO volume proportion. If the user holds a position, a tick mark overlays their entry point. Raw numbers visible on tap only.

**Rationale:** Direct user request. Simultaneously encodes three data points (time remaining, market sentiment, open position) in a single glance-readable element with zero added vertical space. All data already exists — purely a frontend change.

**Downsides:** Dual-color encoding for time vs. volume could confuse users who expect a single-variable bar. Needs a tooltip or brief first-use explanation.

**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

---

### 2. Real-Time Payout Calculator in BetSheet
**Description:** Large drag-slider inside the existing Vaul BetSheet for coin amount. As user drags, three values update live in large text: coins wagered, payout if YES, payout if NO. LMSR cost function runs client-side on every drag event — zero API calls. A secondary line shows price impact (how much this trade moves the market). Green "Submit" CTA at bottom unchanged.

**Rationale:** getspike's #1 differentiator in the bet flow. Users currently bet blind — they see a probability but not a concrete payout. Without a payout anchor there's no rational basis for sizing a bet. The LMSR formula is already in the codebase; this is a pure UI surface change.

**Downsides:** Client-side LMSR must stay in sync with server state. A stale price could show a slightly wrong payout. Need reconciliation on submission (show diff + confirm if price moved).

**Confidence:** 95%
**Complexity:** Low-Medium
**Status:** Unexplored

---

### 3. AI Projection Badge in Feed + Market Detail
**Description:** Each FeedCard gets a corner pill badge: **ON TRACK** (green) / **AT RISK** (amber) / **BREAKING OUT** (purple). Derived server-side: compare current views/hr trend vs. the velocity needed to hit `milestoneThreshold` by `resolvesAt`. Computed at feed generation, refreshed every 5–10 minutes. On market detail, the badge appears prominently above the bet panel with a one-sentence explanation ("Views/hr dropped 40% below target — 18h remaining").

**Rationale:** Highest-signal decision aid for fast scrollers. getspike surfaces this prominently. The projection is derivable from fields the backend already tracks (`tiktokPolls` history + `resolvesAt` + `milestoneThreshold`). Gives casual users an instant verdict without reading any numbers.

**Downsides:** Projection accuracy depends on the heuristic quality. False "ON TRACK" labels for videos that spike late can erode trust. Start with a simple rule-based approach, not ML.

**Confidence:** 90%
**Complexity:** Medium (projection logic + caching layer)
**Status:** Unexplored

---

### 4. Dense Metrics Drawer (Advanced Stats Panel)
**Description:** A "Stats" pill on each FeedCard (or bottom of market detail) opens a Vaul half-sheet with a 2×3 metrics grid: Views/Hr, Engagement Rate, Virality Rate, Talkability Score, Implied YES Probability, Implied NO Probability + YES/NO Volume. Read-only. Powered by data the TikTok poll cron already fetches — just not yet surfaced. Default feed remains clean; this is opt-in per market via one tap.

**Rationale:** Directly replicates getspike's "analytical heart." Vaul sheet infrastructure already exists in the codebase. Casual users never see the complexity; power users get full data in one tap. Most metrics are derivable from existing `tiktokPolls` rows — no new DB fields needed.

**Downsides:** Some metrics (talkability, engagement rate) need precise formula definitions baked in, or users will not trust the numbers. Must document how each metric is computed.

**Confidence:** 88%
**Complexity:** Medium (metric derivation formulas + UI grid)
**Status:** Unexplored

---

### 5. Resolution Rules Accordion
**Description:** On market detail `/markets/[id]`, a collapsible accordion shows: YES condition (plain English), NO condition, data source ("TikTok public view count"), exact deadline (date + time). A collapsed one-liner ("Resolves YES if hits 650K views by Apr 22, 1:46 PM") is pinned in the BetSheet header above the stake slider — always visible, non-dismissible.

**Rationale:** Pure trust primitive. The most common post-resolution complaint in prediction markets is "I didn't know it resolved that way." The resolution data already exists in the market record — this is a UI render layer with zero new backend work. May require a minor schema addition for structured rule text.

**Downsides:** Needs structured resolution rule text per market. Current admin market creation doesn't produce a dedicated rule string — needs a derived format or a new optional field.

**Confidence:** 92%
**Complexity:** Low
**Status:** Unexplored

---

### 6. Scroll-Adaptive Metric Density
**Description:** Data density as a function of scroll behavior rather than a static toggle. Fast scroll → minimal card (video + linear progress bar only). Scroll slowdown (velocity below threshold) → auto-reveals a compact metric strip (views/hr, engagement rate, implied probability). Dwell > 2s → metric strip locks open. Tap to dismiss. Collapses getspike's mode-switching into the gesture users already perform naturally.

**Rationale:** The platform's stated advantage is keeping the doomscroll layout. This weaponizes that advantage — depth is a natural consequence of slowing down, not a mode switch. Casual users are never overwhelmed; power users never need to tap. Compounds: every scroll session is implicitly a data density calibration.

**Downsides:** Scroll velocity calculation adds JS complexity. Wrong threshold = laggy or jittery reveal. Can interact badly with IntersectionObserver playback logic if not carefully isolated.

**Confidence:** 80%
**Complexity:** Medium-High (scroll velocity detection + conditional rendering)
**Status:** Unexplored

---

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Swipe-to-Stake Gesture | High accidental-bet risk; swipe is a navigation gesture, not a commit gesture |
| 2 | Parlay Builder | New DB schema, complex atomic bet logic, power-user only, premature |
| 3 | Keyboard Shortcut Mode | Niche; low ROI relative to mobile-first focus at this stage |
| 4 | Virality as Card Background Glow | Will feel like a rendering bug without user education; too subtle |
| 5 | Market Cluster Feed Lanes | Requires recommendation system; premature infrastructure investment |
| 6 | Personal Accuracy Score (PAC) | High long-term value but needs significant resolution history to be meaningful |
| 7 | Swipe-Left Comparison Rail | Gesture conflict with horizontal scroll on many devices; complex |
| 8 | Progressive Disclosure via Scroll Depth Within Card | Risks breaking scroll contract users have with the feed |
| 9 | Persistent Floating Payout HUD | Overlaps BetSheet payout calculator; adds permanent chrome for one use case |
| 10 | One-Tap Parlay | Out of scope; new bet type, new backend |
| 11 | Comments Section | Excluded by user — deferred to a future session |

## Session Log
- 2026-04-15: Initial ideation — 40 raw candidates generated across 5 frames, 6 survivors (comments excluded per user). Source: getspike.app feature analysis + virality codebase scan.
