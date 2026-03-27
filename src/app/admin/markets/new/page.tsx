"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoMetadata, createMarket } from "@/lib/actions/admin";
import type {
  RiskTier,
  ContractRecommendation,
  LLMContractRecommendation,
} from "@/lib/contract";
import { isLLMRecommendation } from "@/lib/contract";

import { snapToPreset, computeStep, computeMilestoneFloor, computeMilestoneMax } from "./helpers";
import { formatCount } from "@/lib/format";

const RESOLUTION_PRESETS = [24, 48, 72] as const;
const RESOLUTION_LABELS: Record<(typeof RESOLUTION_PRESETS)[number], string> = {
  24: "24h",
  48: "48h",
  72: "72h",
};

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
    channelId: string;
    description: string;
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
  const [resolutionHours, setResolutionHours] = useState("");
  const [riskTier, setRiskTier] = useState<RiskTier | null>(null);
  const [questionType, setQuestionType] = useState<"views" | "likes">("views");

  // Anchor — the original AI recommendation, used as fixed reference for proportional adjustments.
  const [anchorMilestone, setAnchorMilestone] = useState<number | null>(null);
  const [anchorHours, setAnchorHours] = useState<number | null>(null);

  // Derived: true once a contract recommendation has loaded. Used to gate proportional controls
  // and form submission separately from the anchor values used for math.
  const contractLoaded = anchorMilestone !== null;
  // Current analytics for the active metric — drives the 20% floor.
  const currentAnalytics =
    questionType === "views"
      ? (videoPreview?.viewCount ?? 0)
      : (videoPreview?.likeCount ?? 0);

  // Milestone slider bounds:
  //   floor = max(0.1× anchor, ceil(currentAnalytics × 1.2)) — target must require future growth.
  //   ceiling = max(5× anchor, ceil(currentAnalytics × 1.5)) — guarantees headroom above the floor.
  const milestoneFloor = contractLoaded
    ? computeMilestoneFloor(anchorMilestone!, currentAnalytics)
    : 0;
  const milestoneMax = contractLoaded
    ? computeMilestoneMax(anchorMilestone!, currentAnalytics)
    : 100;
  const milestoneStep = contractLoaded
    ? computeStep(Math.max(milestoneFloor, anchorMilestone!))
    : 1;

  // Re-clamp milestone when questionType switches or floor shifts (e.g. after a re-fetch).
  // milestoneThreshold is intentionally absent from the dep array — it is read for comparison
  // only. Adding it would re-fire this effect on every slider move, fighting user input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!anchorMilestone || !milestoneThreshold) return;
    if (Number(milestoneThreshold) < milestoneFloor) {
      setMilestoneThreshold(String(milestoneFloor));
    }
  }, [questionType, milestoneFloor]);

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
    setResolutionHours("");
    setQuestionType("views");
    setAnchorMilestone(null);
    setAnchorHours(null);
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
          // Clamp to the 20% floor (questionType resets to "views" at fetch start).
          // Anchor is set to the clamped value — not the raw AI recommendation — so
          // proportional slider/resolution math stays correct when floor > AI recommendation.
          const clampedMilestone = computeMilestoneFloor(
            result.contract.milestoneThreshold,
            result.viewCount
          );
          // Guard: cap anchorHours at 72 in case of in-flight responses during deploy
          const safeResolutionHours = Math.min(result.contract.resolutionHours, 72) as 24 | 48 | 72;
          setMilestoneThreshold(String(clampedMilestone));
          setBParameter(String(result.contract.bParameter));
          setResolutionHours(String(safeResolutionHours));
          setRiskTier(result.contract.riskTier);
          setAnchorMilestone(clampedMilestone);
          setAnchorHours(safeResolutionHours);
          // Validate LLM value before setting — guards against unexpected enum values
          if (isLLMRecommendation(result.contract)) {
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

  function handleMilestoneSlider(rawValue: string) {
    const value = Math.round(Number(rawValue));
    setMilestoneThreshold(String(value));
    if (anchorMilestone !== null && anchorHours !== null) {
      setResolutionHours(snapToPreset(anchorHours * (value / anchorMilestone)));
    }
  }

  function handleResolutionButton(hours: number) {
    setResolutionHours(String(hours));
    if (anchorMilestone !== null && anchorHours !== null) {
      const raw = Math.round(anchorMilestone * (hours / anchorHours));
      setMilestoneThreshold(String(Math.max(milestoneFloor, Math.min(milestoneMax, raw))));
    }
  }

  const llmContract =
    videoPreview?.contract && isLLMRecommendation(videoPreview.contract)
      ? videoPreview.contract
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
        <input
          type="hidden"
          name="channelId"
          value={videoPreview?.channelId ?? ""}
        />
        <input
          type="hidden"
          name="videoDescription"
          value={videoPreview?.description ?? ""}
        />
        <input
          type="hidden"
          name="initialViewCount"
          value={videoPreview?.viewCount ?? ""}
        />
        <input
          type="hidden"
          name="initialLikeCount"
          value={videoPreview?.likeCount ?? ""}
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
            <input type="hidden" name="milestoneThreshold" value={milestoneThreshold} />
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {contractLoaded ? milestoneFloor.toLocaleString() : "–"}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {milestoneThreshold
                    ? Number(milestoneThreshold).toLocaleString()
                    : "–"}
                </span>
                <span>
                  {contractLoaded ? milestoneMax.toLocaleString() : "–"}
                </span>
              </div>
              <input
                type="range"
                disabled={!contractLoaded}
                min={milestoneFloor}
                max={milestoneMax}
                step={milestoneStep}
                value={milestoneThreshold || "0"}
                onChange={(e) => handleMilestoneSlider(e.target.value)}
                className="w-full disabled:opacity-40 cursor-pointer"
              />
              {videoPreview && contractLoaded && (
                <p className="text-xs text-muted">
                  Current: {formatCount(currentAnalytics)}{" "}
                  {questionType === "views" ? "views" : "likes"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Resolution time + b parameter */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Resolution Window
            </label>
            <input type="hidden" name="resolutionHours" value={resolutionHours} />
            <div className="flex gap-2">
              {RESOLUTION_PRESETS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  disabled={!contractLoaded}
                  onClick={() => handleResolutionButton(hours)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 ${
                    resolutionHours === String(hours)
                      ? "bg-accent text-white"
                      : "bg-accent/10 text-accent hover:bg-accent/20"
                  }`}
                >
                  {RESOLUTION_LABELS[hours]}
                </button>
              ))}
            </div>
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
          disabled={isPending || !videoPreview} // requires a loaded video; contract may be null if analytics fail
          className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {isPending ? "Creating..." : "Create Market"}
        </button>
      </form>
    </div>
  );
}
