---
date: 2026-04-03
topic: ux-navigation-layout
focus: Optimize UX and layout — where buttons and numbers are displayed, flow of navigation, make it seamless and addicting
---

# Ideation: UX Navigation & Layout

## Codebase Context

**Project shape:** Next.js App Router, TypeScript, Tailwind CSS, Drizzle ORM, Neon Postgres, LMSR pricing engine.

**Pages:** `/` (home feed/MarketCard grid), `/markets/[id]` (TikTok embed left + TradePanel right), `/portfolio`, `/leaderboard`, `/history`, `/profile`, `/admin`

**Key components:** MarketCard (whole card is a link, no CTA button), TradePanel (fixed presets 10/25/50/100, debounced preview), Navbar (no balance shown), UserMenu, PriceChart, LiveEngagementStats, DailyReward

**Key mechanics:** LMSR pricing (priceYes + priceNo ≈ 1), daily login reward + streak, coin economy (1000-coin signup bonus), 5-minute halt window before market resolution

**Known UX pain points:**
1. No coin balance in navbar — must visit /portfolio to check
2. MarketCard has no CTA — whole card is a link with no visible trade affordance
3. Fixed bet presets (10/25/50/100) feel low relative to growing balances
4. TradePanel requires 2+ taps minimum (select side → enter amount)
5. No feed-level urgency signals (no price movement, no trending badges)
6. Navbar auth-gates core navigation for logged-out users
7. Portfolio uses dense data tables — hard to scan on mobile
8. No post-trade feedback — panel clears silently after trade
9. Leaderboard rank not surfaced on home page or portfolio
10. 5-minute halt window before resolution is unused/confusing dead UX

**Past learnings:** No prior UX/navigation solutions documented. Coin economy correctness (daily reward, signup bonus, OAuth vs. credentials auth flow) must be respected in any engagement UI. Rate limiting gap exists on trade/reward actions — aggressive mobile UX could expose this.

## Ranked Ideas

### 1. Feed-Level Betting — One-Tap YES/NO from the Home Grid
**Description:** Swipe gesture (right=YES, left=NO) or YES/NO split-button overlay on hover/long-press on MarketCard. Last-used preset amount fires automatically. 2-second undo toast inline. Bottom-sheet bet modal option without losing scroll position.
**Rationale:** Collapses the entire "see market → navigate → select side → enter amount → confirm" funnel into one gesture from the feed. Highest-leverage architectural change.
**Downsides:** Accidental swipes need undo; touch event conflicts with scroll; preset must default sensibly.
**Confidence:** 92%
**Complexity:** Medium
**Status:** Unexplored

### 2. Always-Visible Coin Balance — Persistent Game HUD
**Description:** Coin balance moved to persistent navbar element (desktop) / bottom bar (mobile). Optimistic count-up/down micro-animation on every trade. Tapping opens mini ledger flyout: last 5 transactions, streak status, next daily reward countdown.
**Rationale:** Balance is the foundational anchor — always visible, it reframes the app as a game you're playing. Every other engagement mechanic (streaks, leaderboard, post-trade feedback) gains a persistent reference point.
**Downsides:** Needs SWR polling or SSE to stay live. Optimistic updates require careful reconciliation.
**Confidence:** 95%
**Complexity:** Low-Medium
**Status:** Explored — brainstormed 2026-04-03

### 3. Live Market Moments — Halt Countdown + Resolution Animation + Share Card
**Description:** Unified system for the two highest-emotional market lifecycle moments. (A) Halt window: countdown mode, locked odds, live coins-wagered ticker, "Resolving Soon" rail on home feed, push notification to position holders. (B) Resolution: animated reveal (green burst / muted fade). (C) Post-resolution: shareable image card — thumbnail, call, outcome, payout — with native share.
**Rationale:** Halt window is currently dead UX; resolution is a silent DB update. Converting them into ritual moments creates appointment behavior, reduces churn, and generates organic acquisition via share cards.
**Downsides:** Push notifications require permission; share card generation adds backend endpoint; three sub-features that need to ship together.
**Confidence:** 88%
**Complexity:** Medium-High
**Status:** Explored — brainstormed 2026-04-03

### 4. Live Market Heat Signals on Feed Cards
**Description:** Directional arrow + color-coded delta on priceYes (e.g., ↑+6% last hour). Pulsing HOT badge on volume spikes. Color-temperature gradient on YES/NO split bar shifts cool→hot as one side dominates.
**Rationale:** Turns static browsing into urgency-driven hunting. Rewards contrarians. Makes the feed a live signal dashboard.
**Downsides:** Needs efficient aggregation query (materialized view or cache). Badge threshold needs tuning.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 5. Single-Market Practice Onboarding
**Description:** New users see one pre-seeded practice market (already resolved, fake coins). Auto-expands, guaranteed win, confetti burst, real 1000-coin balance animated in, full feed unlocks. Under 20 seconds, no modals.
**Rationale:** Creates muscle memory, emotional first-win reward, and balance context before revealing the full product.
**Downsides:** Seeded fake market must be excluded from real stats. New user detection must be reliable.
**Confidence:** 80%
**Complexity:** Low-Medium
**Status:** Unexplored

### 6. Reputation Score ("Caller Score") — A Live Prediction Identity
**Description:** Per-user score (0–1000) from calibration, volume, streak. Badge on avatars everywhere. Tapping shows mini profile: top 3 calls, win rate, score breakdown.
**Rationale:** Synthesizes existing data into visible identity. Creates status beyond coin wealth. Makes social proof actionable on every market.
**Downsides:** Score formula needs edge-case handling. Periodic recompute adds backend complexity.
**Confidence:** 78%
**Complexity:** Medium
**Status:** Unexplored

### 7. Mobile-First Portfolio Redesign — Card View with Sparklines
**Description:** Dense data table replaced by position cards on mobile (<768px): thumbnail, YES/NO badge, 48h sparkline since entry, color-coded value vs. cost basis, inline Sell button. Summary row: win rate ring chart, rank badge, total profit. Data table preserved as toggle.
**Rationale:** Offloads portfolio assessment to visual scanning. More legible = more frequent checks = more re-engagement with betting.
**Downsides:** Sparkline needs price history endpoint per position. More complex to implement than a table.
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Tinder-style full-screen swipe feed (replaces grid) | Replaces browsing behavior entirely; very high complexity; removes ability to compare markets |
| 2 | Market card expands in-place (no detail page) | Breaks TikTok embed left-column layout; high technical cost for speculative gain |
| 3 | Prediction as a Quiz (reframe YES/NO as answer tiles) | Surface rebrand, no structural improvement; better as a copy pass detail |
| 4 | Market Discovery via Creator Channel Subscription | Requires subscription model, Following tab, notification system, creator data layer — too much infra |
| 5 | Streak Continuity Shield (purchasable insurance) | Addresses secondary mechanic; streak visibility itself not solved yet |
| 6 | Streak-Gated Multiplier Bets | Complex backend logic; not core UX/navigation flow |
| 7 | Cold Visitor Explainer Overlay | Low-leverage patch on a deeper problem |
| 8 | Auto-Fill Last Bet Amount | Good quick win but too incremental; roll into Feed-Level Betting implementation |
| 9 | Live Betting HUD + Feed Trade Unified Surface (synthesis) | Redundant with top two ideas individually |
| 10 | Social Identity Profile (synthesis) | Too broad; each component survives separately |
| 11 | Ambient Rank Visibility | Decent quick win; consequence of better ideas rather than a driver |

## Session Log
- 2026-04-03: Initial ideation — 48 raw candidates generated across 6 frames, deduped to 21 unique candidates, 7 survived. Ideas #2 and #3 selected for brainstorm.
