"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  publishMarket,
  cancelMarket,
  manualResolve,
  resolveNow,
} from "@/lib/actions/admin";
import type { MarketStatus } from "@/db/schema";

interface Props {
  marketId: string;
  status: MarketStatus;
}

export function AdminMarketActions({ marketId, status }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result) {
        alert(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      {status === "draft" && (
        <button
          onClick={() => handleAction(() => publishMarket(marketId))}
          disabled={isPending}
          className="px-2 py-1 text-xs bg-green/10 text-green rounded hover:bg-green/20 transition-colors disabled:opacity-50"
        >
          Publish
        </button>
      )}

      {(status === "draft" || status === "active" || status === "halted") && (
        <button
          onClick={() => {
            if (confirm("Cancel this market? All users will be refunded.")) {
              handleAction(() => cancelMarket(marketId));
            }
          }}
          disabled={isPending}
          className="px-2 py-1 text-xs bg-red/10 text-red rounded hover:bg-red/20 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      )}

      {(status === "active" || status === "halted") && (
        <button
          onClick={() => {
            if (confirm("Resolve using oracle (latest poll data)?")) {
              handleAction(() => resolveNow(marketId));
            }
          }}
          disabled={isPending}
          className="px-2 py-1 text-xs bg-yellow-500/10 text-yellow-500 rounded hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
        >
          Resolve Now
        </button>
      )}

      {(status === "failed" || status === "resolving") && (
        <>
          <button
            onClick={() => {
              if (confirm("Resolve as YES?")) {
                handleAction(() => manualResolve(marketId, 0));
              }
            }}
            disabled={isPending}
            className="px-2 py-1 text-xs bg-green/10 text-green rounded hover:bg-green/20 transition-colors disabled:opacity-50"
          >
            Resolve YES
          </button>
          <button
            onClick={() => {
              if (confirm("Resolve as NO?")) {
                handleAction(() => manualResolve(marketId, 1));
              }
            }}
            disabled={isPending}
            className="px-2 py-1 text-xs bg-red/10 text-red rounded hover:bg-red/20 transition-colors disabled:opacity-50"
          >
            Resolve NO
          </button>
        </>
      )}
    </div>
  );
}
