"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoMetadata, createMarket } from "@/lib/actions/admin";
import type { RiskTier, ContractRecommendation } from "@/lib/contract";

const RISK_BADGE_STYLES: Record<RiskTier, string> = {
  low: "bg-green-500/10 text-green-600 border border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20",
  high: "bg-red-500/10 text-red-600 border border-red-500/20",
};
const RISK_LABELS: Record<RiskTier, string> = {
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
};

function RiskBadge({ tier }: { tier: RiskTier }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_BADGE_STYLES[tier]}`}
    >
      {RISK_LABELS[tier]}
    </span>
  );
}

export default function CreateMarketPage() {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPreview, setVideoPreview] = useState<{
    videoId: string;
    title: string;
    thumbnail: string;
    channelTitle: string;
    viewCount: number;
    likeCount: number;
    contract: ContractRecommendation | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Contract fields — controlled so they can be auto-populated from analytics.
  const [milestoneThreshold, setMilestoneThreshold] = useState("");
  const [bParameter, setBParameter] = useState("100");
  const [resolutionHours, setResolutionHours] = useState("72");
  const [riskTier, setRiskTier] = useState<RiskTier | null>(null);

  async function handleFetchVideo() {
    // Reset before fetch so stale values from a previous URL don't linger.
    setError("");
    setVideoPreview(null);
    setRiskTier(null);
    setMilestoneThreshold("");
    setBParameter("100");
    setResolutionHours("72");
    if (!videoUrl) return;

    const result = await fetchVideoMetadata(videoUrl);
    if ("error" in result) {
      setError(result.error ?? "Unknown error");
    } else {
      setVideoPreview(result);
      if (result.contract) {
        setMilestoneThreshold(String(result.contract.milestoneThreshold));
        setBParameter(String(result.contract.bParameter));
        setResolutionHours(String(result.contract.resolutionHours));
        setRiskTier(result.contract.riskTier);
      }
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    startTransition(async () => {
      const formData = new FormData(e.currentTarget);
      formData.set("videoUrl", videoUrl);
      formData.set(
        "publishImmediately",
        formData.get("publishImmediately") ? "true" : "false"
      );

      const result = await createMarket(formData);
      if ("error" in result) {
        setError(result.error ?? "Unknown error");
      } else {
        router.push("/admin/markets");
      }
    });
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-6">Create New Market</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Video URL */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            YouTube Video URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleFetchVideo}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors"
            >
              Fetch
            </button>
          </div>
        </div>

        {/* Video preview */}
        {videoPreview && (
          <div className="flex gap-3 p-3 bg-card border border-border rounded-lg">
            <img
              src={videoPreview.thumbnail}
              alt={videoPreview.title}
              className="w-32 h-auto rounded"
            />
            <div className="text-sm flex-1">
              <div className="font-medium">{videoPreview.title}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-muted">{videoPreview.channelTitle}</span>
                {riskTier && <RiskBadge tier={riskTier} />}
              </div>
              <div className="text-muted mt-1">
                {videoPreview.viewCount.toLocaleString()} views ·{" "}
                {videoPreview.likeCount.toLocaleString()} likes
              </div>
            </div>
          </div>
        )}

        {/* Market title */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Market Title
          </label>
          <input
            name="title"
            type="text"
            required
            placeholder='e.g. "Will this video hit 1M views in 72 hours?"'
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Description (optional)
          </label>
          <textarea
            name="description"
            rows={2}
            placeholder="Additional context..."
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>

        {/* Question type + milestone */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Question Type
            </label>
            <select
              name="questionType"
              required
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="views">View milestone</option>
              <option value="likes">Like milestone</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Milestone Target
            </label>
            <input
              name="milestoneThreshold"
              type="number"
              required
              min="1"
              placeholder="e.g. 1000000"
              value={milestoneThreshold}
              onChange={(e) => setMilestoneThreshold(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* Resolution time + b parameter */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Resolution Window
            </label>
            <select
              name="resolutionHours"
              value={resolutionHours}
              onChange={(e) => setResolutionHours(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
              <option value="168">7 days</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Liquidity (b)
            </label>
            <input
              name="bParameter"
              type="number"
              min="1"
              max="1000"
              value={bParameter}
              onChange={(e) => setBParameter(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-muted mt-1">
              Higher = more stable prices. Max loss ≈ b × 0.69
            </p>
          </div>
        </div>

        {/* Publish immediately */}
        <label className="flex items-center gap-2 text-sm">
          <input
            name="publishImmediately"
            type="checkbox"
            defaultChecked
            className="rounded border-border"
          />
          Publish immediately (otherwise saves as draft)
        </label>

        {error && (
          <div className="p-3 bg-red/10 border border-red/20 rounded-lg text-sm text-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || !videoPreview}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {isPending ? "Creating..." : "Create Market"}
        </button>
      </form>
    </div>
  );
}
