"use client";

import { useState, useRef, useEffect, createRef, useMemo, useCallback, type RefObject } from "react";
import useSWR from "swr";
import { FeedCard, type FeedCardHandle } from "./FeedCard";
import { FeedEndGrid } from "./FeedEndGrid";
import { BetSheet } from "./BetSheet";
import { getMarketPrices } from "@/lib/market-utils";
import type { MarketStatus, QuestionType, ProjectionLabel } from "@/db/schema";
import type { TradeResult } from "./BetSheet";
import { useScrollVelocity } from "@/hooks/useScrollVelocity";

async function pollFetcher(url: string): Promise<PollData[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`poll fetch failed: ${res.status}`);
  return res.json();
}

interface FeedMarket {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  resolvesAt: Date | null;
  resolvedAt: Date | null;
  outcome: number | null;
  createdAt: Date;
  videoId: string;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
    playUrl?: string | null;
    creatorId?: string | null;
  } | null;
  quantityYes: string;
  quantityNo: string;
  bParameter: string;
  projectionLabel?: ProjectionLabel | null;
}

interface PollData {
  marketId: string;
  viewCount: number | null;
  likeCount: number | null;
}

interface DiscoverFeedProps {
  feedMarkets: FeedMarket[];
  gridMarkets: FeedMarket[];
  pollData: PollData[];
  userPositionIds?: string[];
}

interface SheetState {
  open: boolean;
  marketId: string;
  prices: number[];
  initialOutcome?: number;
  title: string;
}

const CLOSED_SHEET: SheetState = {
  open: false,
  marketId: "",
  prices: [0.5, 0.5],
  initialOutcome: undefined,
  title: "",
};

export function DiscoverFeed({
  feedMarkets,
  gridMarkets,
  pollData,
  userPositionIds,
}: DiscoverFeedProps) {
  // Live poll data — refreshes every 60s so the ProgressRing stays current.
  // Falls back to the server-rendered pollData prop on the initial render.
  const { data: livePollData } = useSWR<PollData[]>(
    "/api/feed/polls",
    pollFetcher,
    { refreshInterval: 60_000, fallbackData: pollData, revalidateOnFocus: false }
  );

  const [sheet, setSheet] = useState<SheetState>(CLOSED_SHEET);
  // Live price overrides — written immediately after a trade so the feed bar
  // reflects the new YES/NO split before the next SSR revalidation.
  const [livePrices, setLivePrices] = useState<Map<string, [number, number]>>(new Map);
  const feedColumnRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const activeIdxRef = useRef<number>(-1);
  // Tracked as a ref so the scroll velocity callback can read it without being
  // re-registered each time sheet.open changes.
  const sheetOpenRef = useRef(false);

  // Ref array resizes to match feedMarkets exactly — prevents stale refs when markets are added/removed.
  const cardRefs = useRef<RefObject<FeedCardHandle | null>[]>([]);
  if (cardRefs.current.length !== feedMarkets.length) {
    cardRefs.current = feedMarkets.map(
      (_, i) => cardRefs.current[i] ?? createRef<FeedCardHandle>()
    );
  }

  useEffect(() => {
    const container = feedColumnRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;

          // Sentinel: FeedEndGrid entered — deactivate current card
          if (el === sentinelRef.current) {
            const prev = activeIdxRef.current;
            if (prev !== -1) {
              cardRefs.current[prev]?.current?.deactivate();
              const prevEl = container.querySelector<HTMLElement>(`[data-card-index="${prev}"]`);
              if (prevEl) prevEl.removeAttribute("data-active");
            }
            activeIdxRef.current = -1;
            return;
          }

          const idx = Number(el.dataset.cardIndex);
          if (isNaN(idx)) return;

          // Deactivate only the previously active card (O(1) instead of O(n))
          const prev = activeIdxRef.current;
          if (prev !== -1 && prev !== idx) {
            cardRefs.current[prev]?.current?.deactivate();
            const prevEl = container.querySelector<HTMLElement>(`[data-card-index="${prev}"]`);
            if (prevEl) prevEl.removeAttribute("data-active");
          }

          activeIdxRef.current = idx;
          el.setAttribute("data-active", "true");
          cardRefs.current[idx]?.current?.activate();
        });
      },
      { root: container, threshold: 0.6 }
    );

    container
      .querySelectorAll<HTMLElement>("[data-card-index]")
      .forEach((el) => observer.observe(el));
    if (sentinelRef.current) observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [feedMarkets.length]);

  // Keep sheetOpenRef in sync so the velocity callback can guard without
  // needing sheet.open in its closure (which would force re-registration).
  useEffect(() => { sheetOpenRef.current = sheet.open; }, [sheet.open]);

  // Scroll velocity → density dispatch. Callback pattern (not state) means
  // DiscoverFeed never re-renders for density changes — only the targeted FeedCard
  // re-renders via its own setDensityState.
  useScrollVelocity(feedColumnRef, useCallback((d) => {
    if (sheetOpenRef.current) return;
    const idx = activeIdxRef.current;
    if (idx === -1) return;
    cardRefs.current[idx]?.current?.setDensity(d);
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset density to full when the sheet closes, mirroring activate()'s reset.
  useEffect(() => {
    if (sheet.open) return;
    const idx = activeIdxRef.current;
    if (idx === -1) return;
    cardRefs.current[idx]?.current?.setDensity("full");
  }, [sheet.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // O(1) position lookup — which feed markets the logged-in user holds shares in.
  const positionSet = useMemo(() => new Set(userPositionIds ?? []), [userPositionIds]);

  // Stable poll lookup — keyed by marketId. Rebuilds when livePollData updates.
  const pollMap = useMemo(
    () => new Map((livePollData ?? pollData).map((p) => [p.marketId, p] as const)),
    [livePollData, pollData]
  );

  // Pre-compute prices once per market per render cycle so FeedCard receives stable values.
  const pricesByMarketId = useMemo(
    () => new Map(feedMarkets.map((m) => [m.id, getMarketPrices(m)] as const)),
    [feedMarkets]
  );

  // Stable openSheet callback — depends only on setSheet (which is always stable).
  const openSheet = useCallback((market: FeedMarket, initialOutcome?: number) => {
    const prices = getMarketPrices(market);
    setSheet({
      open: true,
      marketId: market.id,
      prices,
      initialOutcome,
      title: market.title,
    });
  }, []);

  // Stable per-card onTap callbacks — recreated only when feedMarkets or openSheet changes.
  const cardTapHandlers = useMemo(
    () => feedMarkets.map((market) => (initialOutcome?: number) => openSheet(market, initialOutcome)),
    [feedMarkets, openSheet]
  );

  const closeSheet = useCallback(() => setSheet(CLOSED_SHEET), []);

  // Called by BetSheet when a trade completes. Derive new priceYes/priceNo from
  // the TradeResult and write them into the live override map so the feed bar
  // updates immediately with a 0.3s transition (no page reload needed).
  // TradeResult.priceAfter = new price of the TRADED outcome (outcome 0=YES, 1=NO).
  // The other outcome is derived as 1 - priceAfter (LMSR approximation, fine for display).
  const handleTradeSuccess = useCallback((result: TradeResult) => {
    const newPriceYes = result.outcome === 0 ? result.priceAfter : 1 - result.priceAfter;
    setLivePrices((prev) => {
      const next = new Map(prev);
      next.set(sheet.marketId, [newPriceYes, 1 - newPriceYes]);
      return next;
    });
  }, [sheet.marketId]);

  return (
    <>
      {/* Feed column — snap scroll container */}
      <div
        ref={feedColumnRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory hide-scrollbar"
      >
        {feedMarkets.map((market, index) => {
          const poll = pollMap.get(market.id);
          // Live overrides take priority — written immediately post-trade for instant bar feedback.
          const prices = livePrices.get(market.id) ?? pricesByMarketId.get(market.id) ?? [0.5, 0.5];
          const currentCount =
            poll
              ? market.questionType === "likes"
                ? (poll.likeCount ?? null)
                : (poll.viewCount ?? null)
              : null;

          return (
            <div key={market.id} className="snap-start h-screen" data-card-index={index}>
              <FeedCard
                ref={cardRefs.current[index]}
                id={market.id}
                title={market.title}
                status={market.status}
                questionType={market.questionType}
                milestoneThreshold={market.milestoneThreshold}
                priceYes={prices[0]}
                priceNo={prices[1]}
                quantityYes={parseFloat(market.quantityYes)}
                quantityNo={parseFloat(market.quantityNo)}
                bParameter={parseFloat(market.bParameter)}
                videoId={market.videoId}
                videoMetadata={market.videoMetadata}
                currentCount={currentCount}
                resolvesAt={market.resolvesAt?.toISOString() ?? null}
                userHasPosition={positionSet.has(market.id)}
                priority={index < 2}
                projectionLabel={market.projectionLabel ?? null}
                onTap={cardTapHandlers[index]}
              />
            </div>
          );
        })}

        {/* End grid — appears after last feed card */}
        <div ref={sentinelRef} className="snap-start min-h-screen">
          <FeedEndGrid gridMarkets={gridMarkets} />
        </div>
      </div>

      {/* Bet sheet */}
      <BetSheet
        open={sheet.open}
        onOpenChange={(v) => !v && closeSheet()}
        marketId={sheet.marketId}
        prices={sheet.prices}
        initialOutcome={sheet.initialOutcome}
        title={sheet.title}
        containerRef={feedColumnRef}
        onTradeSuccess={handleTradeSuccess}
      />
    </>
  );
}
