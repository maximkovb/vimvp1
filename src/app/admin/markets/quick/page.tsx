"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchVideoStats, createTestMarket, type VideoStatsSuccess } from "@/lib/actions/admin";
import { extractVideoId } from "@/lib/youtube";

export default function QuickCreatePage() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoStats, setVideoStats] = useState<VideoStatsSuccess | null>(null);
  const [contractTitle, setContractTitle] = useState("");
  const [milestone, setMilestone] = useState("");
  const [questionType, setQuestionType] = useState<"views" | "likes">("views");
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [createError, setCreateError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function handleFetch() {
    const trimmed = videoUrl.trim();
    if (!trimmed) return;

    // Reset state before await to prevent stale values on re-fetch
    setVideoStats(null);
    setContractTitle("");
    setFetchError("");
    setCreateError("");
    setCreatedId(null);
    setIsFetching(true);

    const result = await fetchVideoStats(trimmed);
    setIsFetching(false);

    if ("error" in result) {
      setFetchError(result.error as string);
    } else {
      setVideoStats(result);
      setContractTitle(result.title);
    }
  }

  async function handleCreate() {
    if (!videoStats || !milestone) return;

    const milestoneNum = parseFloat(milestone);
    if (!isFinite(milestoneNum) || milestoneNum < 1) {
      setCreateError("Milestone must be a number ≥ 1");
      return;
    }

    setIsCreating(true);
    setCreateError("");

    const result = await createTestMarket(videoUrl.trim(), milestoneNum, questionType, contractTitle.trim());
    setIsCreating(false);

    if ("error" in result) {
      setCreateError(result.error as string);
    } else {
      setCreatedId(result.marketId);
    }
  }

  const canFetch = !!extractVideoId(videoUrl.trim()) && !isFetching;
  const canCreate = !!videoStats && !!milestone && parseFloat(milestone) >= 1
    && contractTitle.trim().length > 0 && !isCreating;

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">Quick Test Market</h1>
        <p className="text-sm text-muted">
          Creates an active market with b=0.01 and 48h resolution. For testing oracle
          resolution without the full AI suggestion pipeline.
        </p>
      </div>

      {/* Step 1: URL */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-medium mb-3">Step 1 — Paste YouTube URL</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canFetch) handleFetch(); }}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={handleFetch}
            disabled={!canFetch}
            className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {isFetching ? "Fetching…" : "Fetch"}
          </button>
        </div>
        {fetchError && (
          <p className="text-sm text-red mt-2">{fetchError}</p>
        )}

        {/* Video preview */}
        {videoStats && (
          <div className="flex items-start gap-3 mt-3 p-3 bg-background rounded-lg border border-border">
            {videoStats.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={videoStats.thumbnail}
                alt=""
                className="w-24 aspect-video object-cover rounded flex-shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted truncate">{videoStats.title}</div>
              <div className="text-xs text-muted mt-0.5">{videoStats.channelTitle}</div>
              <div className="text-xs text-muted mt-1">
                {videoStats.viewCount.toLocaleString()} views ·{" "}
                {videoStats.likeCount.toLocaleString()} likes
              </div>
              <div className="mt-2">
                <label className="block text-xs text-muted mb-1">Contract title</label>
                <input
                  type="text"
                  value={contractTitle}
                  onChange={(e) => setContractTitle(e.target.value)}
                  placeholder='e.g. "Will this hit 1M views in 48h?"'
                  className="w-full px-2 py-1.5 bg-card border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Market config */}
      {videoStats && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <h2 className="text-sm font-medium mb-3">Step 2 — Set Milestone</h2>

          <div className="flex gap-3 mb-3">
            <button
              onClick={() => setQuestionType("views")}
              className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${
                questionType === "views"
                  ? "bg-accent text-white"
                  : "bg-background border border-border hover:bg-card-hover"
              }`}
            >
              Views
            </button>
            <button
              onClick={() => setQuestionType("likes")}
              className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${
                questionType === "likes"
                  ? "bg-accent text-white"
                  : "bg-background border border-border hover:bg-card-hover"
              }`}
            >
              Likes
            </button>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">
              Milestone target ({questionType})
            </label>
            <input
              type="number"
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              placeholder={`e.g. ${
                questionType === "views"
                  ? Math.round(videoStats.viewCount * 1.5).toLocaleString()
                  : Math.round(videoStats.likeCount * 1.5).toLocaleString()
              }`}
              min="1"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-muted mt-1">
              Current: {(questionType === "views" ? videoStats.viewCount : videoStats.likeCount).toLocaleString()} · b=0.01 · resolves in 48h
            </p>
          </div>

          {createError && (
            <p className="text-sm text-red mt-3">{createError}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="w-full mt-4 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {isCreating ? "Creating…" : "Create Test Market"}
          </button>
        </div>
      )}

      {/* Success */}
      {createdId && (
        <div className="bg-green/10 border border-green/20 rounded-xl p-4 text-sm">
          <div className="font-medium text-green mb-2">Market created</div>
          <div className="flex gap-3">
            <Link href={`/markets/${createdId}`} className="text-accent hover:underline">
              View market →
            </Link>
            <Link href="/admin/markets" className="text-accent hover:underline">
              Back to list →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
