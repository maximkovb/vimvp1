"use client";

import { useState, useTransition } from "react";
import { claimDailyReward } from "@/lib/actions/economy";

interface Props {
  alreadyClaimed: boolean;
  currentStreak: number;
}

export function DailyReward({ alreadyClaimed, currentStreak }: Props) {
  const [claimed, setClaimed] = useState(alreadyClaimed);
  const [result, setResult] = useState<{
    reward: number;
    streak: number;
    streakBonus: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClaim() {
    startTransition(async () => {
      const res = await claimDailyReward();
      if ("success" in res) {
        setClaimed(true);
        setResult({
          reward: res.reward,
          streak: res.streak,
          streakBonus: res.streakBonus,
        });
      }
    });
  }

  if (claimed) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Daily Reward</div>
            {result ? (
              <div className="text-xs text-green mt-1">
                +{result.reward} coins collected!
                {result.streakBonus > 0 && (
                  <span className="text-muted">
                    {" "}
                    (includes {result.streakBonus} streak bonus)
                  </span>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted mt-1">
                Already claimed today
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-muted">Streak</div>
            <div className="text-lg font-bold">
              {result?.streak ?? currentStreak} days
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-accent/30 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Daily Reward Available!</div>
          <div className="text-xs text-muted mt-1">
            {currentStreak > 0
              ? `${currentStreak}-day streak — claim to continue!`
              : "Start a streak for bonus coins"}
          </div>
        </div>
        <button
          onClick={handleClaim}
          disabled={isPending}
          className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "Claiming..." : "Claim"}
        </button>
      </div>
    </div>
  );
}
