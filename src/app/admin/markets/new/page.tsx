"use client";

export const maxDuration = 30;

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoMetadata, createMarket } from "@/lib/actions/admin";
import type {
  RiskTier,
  ContractRecommendation,
  LLMContractRecommendation,
} from "@/lib/contract";

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
    contract: ContractRecommendation | LLMContractRecommendation | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Contract fields — controlled so they can be auto-populated from analytics.
  const [milestoneThreshold, setMilestoneThreshold] = useState("");
  const [bParameter, setBParameter] = useState("100");
  const [resolutionHours, setResolutionHours] = useState("72");
  const [riskTier, setRiskTier] = useState<RiskTier | null>(null);
  const [questionType, setQuestionType] = useState<"views" | "likes">("views");

  // Cancellation token — prevents a stale first-fetch response from overwriting
  // form state set by a second fetch that completed first.
  const fetchTokenRef = useRef<{ canceled: boolean } | null>(null);

  async function handleFetchVideo() {
    // Cancel any in-flight fetch
    if (fetchTokenRef.current) fetchTokenRef.current.canceled = true;
    const token = { canceled: false };
    fetchTokenRef.current = token;

    // All resets happen synchronously before the await
    setError("");
    setVideoPreview(null);
    setRiskTier(null);
    setMilestoneThreshold("");
    setBParameter("100");
    setResolutionHours("72");
    setQuestionType("views");
    setIsLoading(true);

    if (!videoUrl) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchVideoMetadata(videoUrl);
      if (token.canceled) return; // stale response — discard

      if ("error" in result) {
        setError(result.error ?? "Unknown error");
      } else {
        if (result.contract) {
          setMilestoneThreshold(String(result.contract.milestoneThreshold));
          setBParameter(String(result.contract.bParameter));
          setResolutionHours(String(result.contract.resolutionHours));
          setRiskTier(result.contract.riskTier);
          // Validate LLM value before setting — guards against unexpected enum values
          if ("questionTypeRecommendation" in result.contract) {
            const rec = result.contract.questionTypeRecommendation;
            setQuestionType(rec === "likes" ? "likes" : "views");
          }
        }
        setVideoPreview(result);
      }
    } finally {
      if (!token.canceled) setIsLoading(false);
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

  const llmContract =
    videoPreview?.contract && "predictionSource" in videoPreview.contract
      ? (videoPreview.contract as LLMContractRecommendation)
      : null;

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
              disabled={isLoading}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Fetching…" : "Fetch"}
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
              {llmContract && (
                <div className="mt-3 p-3 bg-muted/40 rounded-md border border-border/50 text-sm">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    AI Analysis
                  </span>
                  <p className="mt-1 text-muted-foreground leading-relaxed">
                    {llmContract.reasoning}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden inputs so createMarket can read metadata without re-fetching */}
        <input
          type="hidden"
          name="videoTitle"
          value={videoPreview?.title ?? ""}
        />
        <input
          type="hidden"
          name="thumbnail"
          value={videoPreview?.thumbnail ?? ""}
        />
        <input
          type="hidden"
          name="channelTitle"
          value={videoPreview?.channelTitle ?? ""}
        />

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
              value={questionType}
              onChange={(e) =>
                setQuestionType(e.target.value as "views" | "likes")
              }
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
