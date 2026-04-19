"use client";

import type React from "react";
import Image from "next/image";
import { useState, useRef, forwardRef, useImperativeHandle, useEffect, memo } from "react";
import { TIKTOK_THUMBNAIL_RE } from "@/lib/constants";
import { TradePanel } from "./TradePanel";
import { formatTimeRemaining } from "./CountdownTimer";
import type { MarketStatus, QuestionType, ProjectionLabel } from "@/db/schema";
import { deriveResolutionRules } from "@/lib/resolution-rules";
import type { Density } from "@/types/feed";

export interface FeedCardHandle {
  activate(): void;
  deactivate(): void;
  setDensity(density: Density): void;
}

interface FeedCardProps {
  id: string;
  title: string;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: bigint;
  priceYes: number;
  priceNo: number;
  quantityYes: number;
  quantityNo: number;
  bParameter: number;
  videoId: string;
  videoMetadata: {
    title: string;
    thumbnail: string;
    channelTitle: string;
    playUrl?: string | null;
    creatorId?: string | null;
  } | null;
  currentCount: number | null; // latest viewCount or likeCount from tiktokPolls
  resolvesAt?: string | null;
  projectionLabel?: ProjectionLabel | null;
  userHasPosition?: boolean;
  priority?: boolean;
  onTap: (initialOutcome?: number) => void;
}

const DENSITY_BADGE_STYLE: Record<Density, React.CSSProperties> = {
  full:    { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.15s ease-out" },
  compact: { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.15s ease-out" },
  minimal: { opacity: 0, pointerEvents: "none",  transition: "opacity 0.15s ease-out" },
};

const DENSITY_LABEL_STYLE: Record<Density, React.CSSProperties> = {
  full:    { opacity: 1, visibility: "visible", transition: "opacity 0.15s ease-out, visibility 0.15s ease-out" },
  compact: { opacity: 0, visibility: "hidden",  transition: "opacity 0.15s ease-out, visibility 0.15s ease-out" },
  minimal: { opacity: 0, visibility: "hidden",  transition: "opacity 0.15s ease-out, visibility 0.15s ease-out" },
};

const DENSITY_BUTTON_STYLE: Record<Density, React.CSSProperties> = {
  full:    { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.1s ease-out" },
  compact: { opacity: 1, pointerEvents: "auto",  transition: "opacity 0.1s ease-out" },
  minimal: { opacity: 0, pointerEvents: "none",  transition: "opacity 0.1s ease-out" },
};

function formatCount(n: number | null) {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

const PROJECTION_BADGE: Record<ProjectionLabel, { label: string; className: string }> = {
  ON_TRACK:     { label: "On Track",     className: "bg-green-500/20 text-green-400 border border-green-500/40" },
  AT_RISK:      { label: "At Risk",      className: "bg-amber-500/20 text-amber-400 border border-amber-500/40" },
  BREAKING_OUT: { label: "Breaking Out", className: "bg-blue-500/20 text-blue-400 border border-blue-500/40" },
};

function formatTarget(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

interface ProgressBarProps {
  current: number | null;
  target: bigint;
  priceYes: number;
  priceNo: number;
  userHasPosition?: boolean;
  /** When true, plays a fill animation from 0 → current value. Only fires once per mount. */
  animate?: boolean;
  /** Show numeric labels inline (desktop). On mobile, labels appear in a tap tooltip. */
  showLabels?: boolean;
}

// Phases for the one-shot fill animation:
//   idle    — not yet activated; bar shows current fillPct with no transition
//   pending — activate() fired; bar SNAPS to 0% (no transition) so the fill has a clean origin
//   filling — after two RAFs (0% has been painted); bar TRANSITIONS left→right to fillPct
//   done    — animation finished; bar tracks fillPct with a short transition for live updates
type AnimPhase = "idle" | "pending" | "filling" | "done";

function ProgressBar({
  current,
  target,
  priceYes,
  priceNo,
  userHasPosition,
  animate,
  showLabels,
}: ProgressBarProps) {
  const targetNum = Number(target);
  const fillPct =
    current !== null && targetNum > 0 ? Math.min(current / targetNum, 1) : 0;

  const [phase, setPhase] = useState<AnimPhase>("idle");
  const hasTriggered = useRef(false);

  // idle → pending when animate prop goes true (once per mount)
  useEffect(() => {
    if (animate && !hasTriggered.current) {
      hasTriggered.current = true;
      setPhase("pending");
    }
  }, [animate]);

  // pending → filling: wait two RAFs so the 0%-width paint lands before the transition starts
  useEffect(() => {
    if (phase !== "pending") return;
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("filling"));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [phase]);

  // filling → done after the CSS transition completes
  useEffect(() => {
    if (phase !== "filling") return;
    const t = setTimeout(() => setPhase("done"), 850);
    return () => clearTimeout(t);
  }, [phase]);

  // pending: snap to 0 so the fill animation has a clear left-edge origin
  // all other phases: track the real fillPct
  const displayFill = phase === "pending" ? 0 : fillPct;

  // filling: slow entry animation; done: short transition for live price/view updates
  const transitionStyle =
    phase === "filling"
      ? "width 0.8s ease-out"
      : phase === "done"
        ? "width 0.3s ease-out"
        : "none";

  const [showTooltip, setShowTooltip] = useState(false);

  const isEmpty = current === null || targetNum === 0;

  return (
    <div className="relative w-full">
      {/* Bar track */}
      <div
        className="relative w-full h-[6px] bg-white/10 overflow-hidden cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setShowTooltip((v) => !v);
        }}
      >
        {isEmpty ? (
          <div className="h-full w-full animate-pulse bg-white/10" />
        ) : (
          <>
            {/* YES fill (green) */}
            <div
              className="absolute left-0 top-0 h-full bg-green"
              style={{ width: `${displayFill * priceYes * 100}%`, transition: transitionStyle }}
            />
            {/* NO fill (red) — starts where YES ends */}
            <div
              className="absolute top-0 h-full bg-red"
              style={{
                left: `${displayFill * priceYes * 100}%`,
                width: `${displayFill * priceNo * 100}%`,
                transition: transitionStyle,
              }}
            />
            {/* User position tick — thin white line at current fill edge */}
            {userHasPosition && displayFill > 0 && (
              <div
                className="absolute top-0 h-full w-[2px] bg-white z-10"
                style={{
                  left: `${displayFill * 100}%`,
                  transition: transitionStyle,
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Tap tooltip (mobile) — numbers above the bar */}
      {showTooltip && !isEmpty && (
        <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 text-white text-[10px] font-medium px-2 py-1 rounded pointer-events-none z-30">
          {formatCount(current)} / {formatTarget(targetNum)}&nbsp;·&nbsp;YES {(priceYes * 100).toFixed(0)}%&nbsp;·&nbsp;NO {(priceNo * 100).toFixed(0)}%
        </div>
      )}

      {/* Always-visible labels (desktop HUD) */}
      {showLabels && !isEmpty && (
        <p className="mt-1 text-[10px] text-muted tabular-nums">
          {formatCount(current)} / {formatTarget(targetNum)}&nbsp;·&nbsp;YES {(priceYes * 100).toFixed(0)}%&nbsp;·&nbsp;NO {(priceNo * 100).toFixed(0)}%
        </p>
      )}
    </div>
  );
}

function MutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export const FeedCard = memo(forwardRef<FeedCardHandle, FeedCardProps>(function FeedCard({
  id,
  title,
  status,
  questionType,
  milestoneThreshold,
  priceYes,
  priceNo,
  quantityYes,
  quantityNo,
  bParameter,
  videoId,
  videoMetadata,
  currentCount,
  resolvesAt,
  projectionLabel,
  userHasPosition,
  priority = false,
  onTap,
}: FeedCardProps, ref) {
  const [currentPlayUrl, setCurrentPlayUrl] = useState(videoMetadata?.playUrl ?? null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(true);
  const [progress, setProgress] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isEnded, setIsEnded] = useState(() =>
    resolvesAt != null && new Date(resolvesAt) <= new Date()
  );

  useEffect(() => {
    if (!resolvesAt || isEnded) return;
    const ms = new Date(resolvesAt).getTime() - Date.now();
    if (ms <= 0) { setIsEnded(true); return; }
    const t = setTimeout(() => setIsEnded(true), ms);
    return () => clearTimeout(t);
  }, [resolvesAt, isEnded]);

  const isEndedRef = useRef(isEnded);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => {
    isEndedRef.current = isEnded;
    if (!resolvesAt || isEnded) {
      setTimeRemaining(null);
      return;
    }
    const rem = new Date(resolvesAt).getTime() - Date.now();
    setTimeRemaining(rem);
    const id = setInterval(() => {
      const remaining = new Date(resolvesAt).getTime() - Date.now();
      setTimeRemaining(remaining);
      if (remaining <= 0 || isEndedRef.current) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resolvesAt, isEnded]);

  // Progress bar animation — fires once on first activate(), then stays true for the
  // lifetime of the component (no re-animation on scroll-back, resets on page refresh).
  const [barAnimate, setBarAnimate] = useState(false);
  const [densityState, setDensityState] = useState<Density>("full");
  const barAnimatedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const desktopVideoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  useImperativeHandle(ref, () => ({
    setDensity(density: Density) {
      setDensityState(density);
    },
    activate() {
      // Reset density to full on re-activation — prevents stale minimal/compact state
      // persisting from a previous fast-swipe-past
      setDensityState("full");
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
      const activeV = isDesktop ? desktopVideoRef.current : videoRef.current;
      const inactiveV = isDesktop ? videoRef.current : desktopVideoRef.current;
      if (!activeV) return;

      // Trigger the progress bar fill animation on the very first activation only.
      if (!barAnimatedRef.current) {
        barAnimatedRef.current = true;
        setBarAnimate(true);
      }

      setProgress(0);
      setIsPaused(false);
      activeV.muted = false;
      setIsMuted(false);

      // Keep the hidden layout's video silent while this one plays
      if (inactiveV) {
        inactiveV.pause();
        inactiveV.muted = true;
      }

      playPromiseRef.current = activeV.play()
        .catch(() => {
          // Autoplay policy blocked unmuted play — fall back to muted
          activeV.muted = true;
          setIsMuted(true);
          // Return the fallback promise so playPromiseRef always represents the
          // live async chain; deactivate() can then safely await it.
          return activeV.play().catch(() => {});
        });
    },
    deactivate() {
      const doStop = () => {
        // Stop both video elements defensively — ensures no hidden audio bleed
        for (const v of [videoRef.current, desktopVideoRef.current]) {
          if (!v) continue;
          v.pause();
          v.muted = true;
        }
        setIsMuted(true);
        setIsPaused(true);
      };
      // Await any pending play() promise before pausing to prevent the
      // play/pause race where play() resolves after pause() and re-starts the video
      if (playPromiseRef.current) {
        playPromiseRef.current.then(doStop).catch(doStop);
        playPromiseRef.current = null;
      } else {
        doStop();
      }
    },
  }));

  useEffect(() => {
    return () => {
      for (const v of [videoRef.current, desktopVideoRef.current]) {
        if (!v) continue;
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, []);

  const thumbnailSrc =
    videoMetadata?.thumbnail && TIKTOK_THUMBNAIL_RE.test(videoMetadata.thumbnail)
      ? videoMetadata.thumbnail
      : null;
  const isTrading = status === "active";

  const resolutionTooltips = isTrading
    ? deriveResolutionRules({
        milestoneThreshold: String(milestoneThreshold),
        resolvesAt: resolvesAt ?? null,
        questionType,
      })
    : null;

  async function handleVideoError() {
    if (refreshing) return;
    setRefreshing(true);
    // Sync muted state before the video remounts so the DOM attribute matches React state
    setIsMuted(true);
    setProgress(0);
    try {
      const res = await fetch(`/api/tiktok/${videoId}/play-url`);
      if (res.ok) {
        const data = await res.json();
        setCurrentPlayUrl(data.playUrl ?? null);
      } else {
        setCurrentPlayUrl(null);
      }
    } catch {
      setCurrentPlayUrl(null);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleMute() {
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    const v = isDesktop ? desktopVideoRef.current : videoRef.current;
    if (!v) return;
    const next = !isMuted;
    v.muted = next;
    setIsMuted(next);
  }

  function togglePause() {
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
    const video = isDesktop ? desktopVideoRef.current : videoRef.current;
    if (!video) return;
    if (video.paused) {
      playPromiseRef.current = video.play().catch(() => {});
    } else {
      const doStop = () => video.pause();
      if (playPromiseRef.current) {
        playPromiseRef.current.then(doStop).catch(doStop);
        playPromiseRef.current = null;
      } else {
        doStop();
      }
    }
  }

  const showEnded = isEnded || status === "resolved" || status === "failed" || status === "cancelled";
  const isUrgent = timeRemaining !== null && timeRemaining > 0 && timeRemaining < 1000 * 60 * 60;
  const timeLabel = showEnded
    ? "Ended"
    : timeRemaining !== null && timeRemaining > 0
      ? `${formatTimeRemaining(timeRemaining)} remaining`
      : null;

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* ── DESKTOP LAYOUT (≥1024px) ─────────────────────────────────────── */}
      <div className="hidden lg:flex flex-row h-full items-center justify-center gap-8 px-12">
        {/* Left: 9:16 native video — controlled by desktopVideoRef / activate() / deactivate() */}
        <div className="relative w-[325px] flex-shrink-0">
          <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
            {currentPlayUrl ? (
              <>
                <video
                  ref={desktopVideoRef}
                  key={currentPlayUrl}
                  src={currentPlayUrl}
                  poster={thumbnailSrc ?? undefined}
                  muted={isMuted}
                  loop
                  playsInline
                  preload={priority ? "metadata" : "none"}
                  className="absolute inset-0 w-full h-full object-cover rounded-xl cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); togglePause(); }}
                  onError={handleVideoError}
                  onStalled={handleVideoError}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (v.duration > 0) setProgress(v.currentTime / v.duration);
                  }}
                  onPause={() => setIsPaused(true)}
                  onPlay={() => setIsPaused(false)}
                />

                {/* Pause overlay */}
                {isPaused && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-xl">
                    <div className="rounded-full bg-black/50 p-3">
                      <PlayIcon />
                    </div>
                  </div>
                )}

                {/* Mute toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                  aria-label={isMuted ? "Unmute" : "Mute"}
                  className="absolute bottom-3 right-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors z-10"
                >
                  {isMuted ? <MutedIcon /> : <UnmutedIcon />}
                </button>
              </>
            ) : thumbnailSrc ? (
              <Image
                src={thumbnailSrc}
                alt={title}
                fill
                className="object-cover rounded-xl"
                priority={priority}
              />
            ) : (
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-card to-background" />
            )}
          </div>
        </div>

        {/* Right: side HUD */}
        <div className="flex flex-col gap-5 w-[360px] flex-shrink-0 overflow-y-auto max-h-screen py-8">
          {/* Status + projection badges */}
          <div className="flex flex-wrap gap-1.5 items-start">
            {(status === "halted" || status === "resolving") ? (
              <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
                {status === "resolving" ? "Resolving" : "Halted"}
              </span>
            ) : null}
            {(status === "resolved" || status === "failed" || status === "cancelled" || isEnded) ? (
              <span className="self-start px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-muted/20 text-muted border border-muted/20">
                Ended
              </span>
            ) : projectionLabel ? (
              <span className={`self-start px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${PROJECTION_BADGE[projectionLabel].className}`}>
                {PROJECTION_BADGE[projectionLabel].label}
              </span>
            ) : null}
          </div>

          {/* Creator + title */}
          <div>
            <p className="text-sm text-muted">
              @{videoMetadata?.channelTitle ?? "Unknown"}
            </p>
            <p className="font-semibold leading-snug mt-1">{title}</p>
          </div>

          {/* Milestone progress bar — full width of the HUD column, labels always visible */}
          <ProgressBar
            current={currentCount}
            target={milestoneThreshold}
            priceYes={priceYes}
            priceNo={priceNo}
            userHasPosition={userHasPosition}
            animate={barAnimate}
            showLabels
          />
          {resolvesAt && timeLabel !== null && (
            <p className={`text-[10px] tabular-nums mt-[-14px] ${isUrgent || showEnded ? "text-red font-medium" : "text-muted"}`}>
              {timeLabel}
            </p>
          )}

          {/* Trade panel or halted badge */}
          {isTrading ? (
            <TradePanel
              marketId={id}
              prices={[priceYes, priceNo]}
              quantities={[quantityYes, quantityNo]}
              bParameter={bParameter}
              yesTooltip={resolutionTooltips?.yesCondition}
              noTooltip={resolutionTooltips?.noCondition}
            />
          ) : (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-sm text-center">
              {status === "resolving" ? "Resolving…" : "Trading halted"}
            </div>
          )}
        </div>
      </div>

      {/* ── MOBILE LAYOUT (<1024px) ──────────────────────────────────────── */}
      <div className="lg:hidden relative w-full h-full cursor-pointer" onClick={() => { if (isTrading) onTap(); }}>
        {/* Full-bleed video */}
        {currentPlayUrl ? (
          <>
            <video
              ref={videoRef}
              key={currentPlayUrl}
              src={currentPlayUrl}
              poster={thumbnailSrc ?? undefined}
              muted={isMuted}
              loop
              playsInline
              preload={priority ? "metadata" : "none"}
              className="absolute inset-0 w-full h-full object-cover"
              data-is-muted={isMuted}
              data-is-paused={isPaused}
              data-progress={Math.round(progress * 100)}
              onClick={(e) => { e.stopPropagation(); togglePause(); }}
              onError={handleVideoError}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration > 0) setProgress(v.currentTime / v.duration);
              }}
              onPause={() => setIsPaused(true)}
              onPlay={() => setIsPaused(false)}
            />

            {/* Pause indicator */}
            {isPaused && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                <div className="rounded-full bg-black/50 p-3">
                  <PlayIcon />
                </div>
              </div>
            )}

            {/* Mute toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="absolute bottom-32 right-4 z-20 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
          </>
        ) : thumbnailSrc ? (
          <Image
            src={thumbnailSrc}
            alt={title}
            fill
            className="object-cover"
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-card to-background" />
        )}

        {/* Gradient overlays */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgba(18,18,18,0.94) 0%, rgba(18,18,18,0.3) 40%, transparent 60%), linear-gradient(to bottom, rgba(18,18,18,0.6) 0%, transparent 25%)",
          }}
        />

        {/* Top-left badges — status + projection stacked; hidden in minimal (fast-swipe) */}
        <div
          className="absolute top-4 left-4 z-10 flex flex-col gap-1.5 items-start"
          style={DENSITY_BADGE_STYLE[densityState]}
        >
          {(status === "halted" || status === "resolving") ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase tracking-wide">
              {status === "resolving" ? "Resolving" : "Halted"}
            </span>
          ) : null}
          {(status === "resolved" || status === "failed" || status === "cancelled" || isEnded) ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-muted/20 text-muted border border-muted/20">
              Ended
            </span>
          ) : projectionLabel ? (
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${PROJECTION_BADGE[projectionLabel].className}`}>
              {PROJECTION_BADGE[projectionLabel].label}
            </span>
          ) : null}
        </div>

        {/* Time remaining — top-right corner, always visible regardless of density */}
        {resolvesAt && (showEnded || timeRemaining !== null) && timeLabel !== null && (
          <span className={`absolute top-4 right-4 z-10 text-[10px] tabular-nums bg-black/40 rounded px-1.5 py-0.5 ${isUrgent || showEnded ? "text-red font-medium" : "text-white/50"}`}>
            {timeLabel}
          </span>
        )}

        {/* Milestone progress bar — sits above bottom nav + safe area */}
        <div className="absolute left-0 right-0 z-20" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
          <ProgressBar
            current={currentCount}
            target={milestoneThreshold}
            priceYes={priceYes}
            priceNo={priceNo}
            userHasPosition={userHasPosition}
            animate={barAnimate}
          />
        </div>

        {/* Bottom content */}
        <div className="absolute left-0 right-0 z-10 p-5" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
          {/* Channel title — hidden in compact + minimal (decorative context).
              opacity+visibility is GPU-composited, avoiding layout recalculation
              per frame that maxHeight transitions would cause. */}
          <p
            className="text-sm text-white/60 mb-1"
            style={DENSITY_LABEL_STYLE[densityState]}
          >
            @{videoMetadata?.channelTitle ?? "Unknown"}
          </p>
          <p className="text-white text-sm leading-snug mb-4 line-clamp-2">{title}</p>
          {/* Target text — hidden in compact + minimal (decorative context) */}
          <p
            className="text-xs text-white/40 mb-3"
            style={DENSITY_LABEL_STYLE[densityState]}
          >
            Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
          </p>

          {/* Video scrubber — only visible when paused */}
          {isPaused && (
            <div className="w-full h-[2px] bg-white/20 mb-3 pointer-events-none">
              <div
                className="h-full bg-white"
                style={{ width: `${progress * 100}%`, transition: 'none' }}
              />
            </div>
          )}

          {/* Bet tray — YES/NO buttons */}
          <div style={DENSITY_BUTTON_STYLE[densityState]}>
            {isTrading && (
              <div className="flex gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTap(0);
                  }}
                  className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-green text-white hover:opacity-90 active:opacity-75"
                >
                  YES&nbsp;{(priceYes * 100).toFixed(0)}%
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTap(1);
                  }}
                  className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-red text-white hover:opacity-90 active:opacity-75"
                >
                  NO&nbsp;{(priceNo * 100).toFixed(0)}%
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}));
