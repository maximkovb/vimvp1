"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { claimDailyReward } from "@/lib/actions/economy";
import { getRecentActivity, type RecentActivityResult } from "@/lib/actions/economy";

interface BalanceData {
  balance: number;
  loginStreak: number;
  lastLoginReward: string | null;
}

interface BalanceChipProps {
  initialBalance?: number;
}

async function balanceFetcher(url: string): Promise<BalanceData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

function CoinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      <circle cx="7" cy="7" r="6.5" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1" />
      <text x="7" y="10.5" textAnchor="middle" fontSize="8" fill="currentColor" fontWeight="bold">¢</text>
    </svg>
  );
}

function FlameIcon() {
  return <span aria-label="streak">🔥</span>;
}

function formatTransactionType(type: string): string {
  switch (type) {
    case "daily_login": return "Daily reward";
    case "signup_bonus": return "Signup bonus";
    case "trade": return "Trade";
    case "payout": return "Payout";
    case "refund": return "Refund";
    default: return type;
  }
}

function getCountdownToMidnightUTC(): string {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const diffMs = midnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function isClaimedToday(lastLoginReward: string | null): boolean {
  if (!lastLoginReward) return false;
  const last = new Date(lastLoginReward);
  const now = new Date();
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  );
}

export function BalanceChip({ initialBalance = 0 }: BalanceChipProps) {
  const { mutate: globalMutate } = useSWRConfig();
  const { data } = useSWR<BalanceData>("/api/balance", balanceFetcher, {
    fallbackData: { balance: initialBalance, loginStreak: 0, lastLoginReward: null },
  });

  const [open, setOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [displayBalance, setDisplayBalance] = useState(initialBalance);
  const [activity, setActivity] = useState<RecentActivityResult | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [claimPending, startClaimTransition] = useTransition();
  const [claimResult, setClaimResult] = useState<{ reward: number; streak: number } | null>(null);
  const [claimedInSession, setClaimedInSession] = useState(false);
  const [countdown, setCountdown] = useState("");

  const prevBalanceRef = useRef(initialBalance);
  const chipRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);

  const balance = data?.balance ?? initialBalance;

  // Animate balance changes (only after first SWR update, not on initial load)
  useEffect(() => {
    const prev = prevBalanceRef.current;
    if (prev === balance) return;

    // Skip animation on very first mount (SWR hydrating fallbackData)
    const diff = balance - prev;
    if (diff === 0) return;

    setAnimating(true);
    const startTime = performance.now();
    const duration = 400;
    const startVal = prev;
    const endVal = balance;

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayBalance(Math.round(startVal + (endVal - startVal) * eased));

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setDisplayBalance(Math.round(endVal));
        setTimeout(() => setAnimating(false), 400); // keep highlight for 800ms total
      }
    }

    animFrameRef.current = requestAnimationFrame(step);
    prevBalanceRef.current = balance;

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [balance]);

  // Keep display balance in sync when not animating
  useEffect(() => {
    if (!animating) {
      setDisplayBalance(Math.round(balance));
      prevBalanceRef.current = balance;
    }
  }, [balance, animating]);

  // Fetch activity lazily when flyout opens
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    const result = await getRecentActivity();
    setActivity(result);
    setActivityLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      loadActivity();
    }
  }, [open, loadActivity]);

  // Countdown ticker
  useEffect(() => {
    if (!open) return;
    setCountdown(getCountdownToMidnightUTC());
    const interval = setInterval(() => {
      setCountdown(getCountdownToMidnightUTC());
    }, 60_000);
    return () => clearInterval(interval);
  }, [open]);

  // Outside click + Escape to close
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function handleClaim() {
    startClaimTransition(async () => {
      const res = await claimDailyReward();
      if ("success" in res) {
        setClaimedInSession(true);
        setClaimResult({ reward: res.reward, streak: res.streak });
        await globalMutate("/api/balance");
        // Refresh activity to show the new transaction
        await loadActivity();
      }
    });
  }

  const alreadyClaimed =
    claimedInSession ||
    isClaimedToday(
      activity && !("error" in activity) ? activity.lastLoginReward?.toISOString() ?? null : data?.lastLoginReward ?? null
    );

  const loginStreak =
    claimResult?.streak ??
    (activity && !("error" in activity) ? activity.loginStreak : (data?.loginStreak ?? 0));

  return (
    <div className="relative" ref={chipRef}>
      {/* The chip button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all border ${
          animating
            ? "border-accent text-accent bg-accent/10 shadow-[0_0_0_2px_var(--accent,#6366f1)22]"
            : "border-border text-foreground bg-card hover:bg-card-hover"
        }`}
        aria-label="Coin balance"
      >
        <CoinIcon />
        <span className="tabular-nums min-w-[2ch] text-right">{displayBalance.toLocaleString()}</span>
      </button>

      {/* Flyout */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Flyout panel */}
          <div className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border">
              <div className="text-xs text-muted uppercase tracking-wide mb-1">Coin Balance</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums">{Math.round(balance).toLocaleString()}</span>
                <span className="text-muted text-sm">coins</span>
              </div>
            </div>

            {/* Recent transactions */}
            <div className="px-4 py-3 border-b border-border">
              <div className="text-xs text-muted uppercase tracking-wide mb-2">Recent Activity</div>
              {activityLoading ? (
                <div className="text-sm text-muted py-2">Loading...</div>
              ) : activity && !("error" in activity) ? (
                activity.transactions.length === 0 ? (
                  <div className="text-sm text-muted py-2">No transactions yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {activity.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between text-sm">
                        <div className="min-w-0 flex-1">
                          <span className="text-foreground">{formatTransactionType(tx.type)}</span>
                          {tx.marketTitle && (
                            <span className="text-muted truncate block text-xs">{tx.marketTitle}</span>
                          )}
                        </div>
                        <span
                          className={`ml-2 font-medium tabular-nums flex-shrink-0 ${
                            tx.amount >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {tx.amount >= 0 ? "+" : ""}{tx.amount.toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : activity && "error" in activity ? (
                <div className="text-sm text-muted py-2">Could not load activity</div>
              ) : null}
            </div>

            {/* Streak + daily reward */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-sm">
                  <FlameIcon />
                  <span className="font-medium">{loginStreak}-day streak</span>
                </div>
              </div>

              {alreadyClaimed ? (
                <div className="text-sm text-muted">
                  {claimResult ? (
                    <span className="text-green">+{claimResult.reward} coins collected!</span>
                  ) : (
                    <span>Already claimed today</span>
                  )}
                  <div className="text-xs mt-1 text-muted">Next reward in {countdown}</div>
                </div>
              ) : (
                <button
                  onClick={handleClaim}
                  disabled={claimPending}
                  className="w-full py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {claimPending ? "Claiming..." : "Claim Daily Reward"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
