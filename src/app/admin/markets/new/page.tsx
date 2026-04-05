"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoStats, fetchMarketSuggestion, createMarket } from "@/lib/actions/admin";
import type { VideoStatsSuccess } from "@/lib/actions/admin";
import type { RiskTier } from "@/lib/contract";
import { isLLMRecommendation } from "@/lib/contract";

import { computeStep, computeMilestoneFloor, computeProbability } from "./helpers";
import { formatCount } from "@/lib/format";
import { CALIBRATED_PROB_MIN, CALIBRATED_PROB_MAX } from "@/lib/calibration";
import { MarketStatsPanel } from "@/components/admin/MarketStatsPanel";

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
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_BADGE_STYLES[tier]}`}>
      {RISK_LABELS[tier]}
    </span>
  );
}

function ProbabilityBadge({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  const isCalibrated = probability >= CALIBRATED_PROB_MIN && probability <= CALIBRATED_PROB_MAX;
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
        isCalibrated
          ? "bg-green-500/10 text-green-600 border-green-500/20"
          : "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
      }`}
    >
      {pct}% YES {isCalibrated ? "✓" : "⚠"}
    </span>
  );
}

type VideoStatsData = VideoStatsSuccess;

export default function CreateMarketPage() {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");

  const [videoStats, setVideoStats] = useState<VideoStatsData | null>(null);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [isFetchingSuggestion, setIsFetchingSuggestion] = useState(false);

  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Contract fields — controlled so they can be auto-populated
  const [milestoneThreshold, setMilestoneThreshold] = useState("");
  const [bParameter, setBParameter] = useState("100");
  const [resolutionHours, setResolutionHours] = useState("");
  const [riskTier, setRiskTier] = useState<RiskTier | null>(null);
  const [questionType, setQuestionType] = useState<"views" | "likes">("views");
  const [titleValue, setTitleValue] = useState("");

  // Live probability — updated on any override
  const [liveProbability, setLiveProbability] = useState<number | null>(null);

  // Anchor — original recommendation used as fixed reference for proportional adjustments
  const [anchorMilestone, setAnchorMilestone] = useState<number | null>(null);
  const [anchorHours, setAnchorHours] = useState<number | null>(null);

  const contractLoaded = anchorMilestone !== null;

  const currentAnalytics =
    questionType === "views"
      ? (videoStats?.viewCount ?? 0)
      : (videoStats?.likeCount ?? 0);

  const milestoneFloor = contractLoaded
    ? computeMilestoneFloor(anchorMilestone!, currentAnalytics)
    : 0;
  const milestoneMax = contractLoaded ? Math.round(anchorMilestone! * 5) : 100;
  const milestoneStep = contractLoaded
    ? computeStep(Math.max(milestoneFloor, anchorMilestone!))
    : 1;

  // Re-clamp milestone when questionType switches or floor shifts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!anchorMilestone || !milestoneThreshold) return;
    if (Number(milestoneThreshold) < milestoneFloor) {
      setMilestoneThreshold(String(milestoneFloor));
    }
  }, [questionType, milestoneFloor]);

  // Recompute live probability whenever relevant fields change.
  useEffect(() => {
    if (!videoStats || !milestoneThreshold || !resolutionHours) return;
    const videoAgeHours = Math.max(
      (Date.now() - new Date(videoStats.publishedAt).getTime()) / 3_600_000,
      0.1
    );
    const prob = computeProbability(
      currentAnalytics,
      videoAgeHours,
      Number(resolutionHours),
      Number(milestoneThreshold),
      videoStats.viewCount
    );
    setLiveProbability(prob);
  }, [milestoneThreshold, resolutionHours, currentAnalytics, videoStats]);

  // Cancellation token — prevents a stale first-fetch response from overwriting
  // form state set by a second fetch that completed first.
  const fetchTokenRef = useRef<{ canceled: boolean } | null>(null);

  async function handleFetchVideo() {
    if (fetchTokenRef.current) fetchTokenRef.current.canceled = true;
    const token = { canceled: false };
    fetchTokenRef.current = token;

    // All resets happen synchronously before the first await
    setError("");
    setVideoStats(null);
    setRiskTier(null);
    setMilestoneThreshold("");
    setBParameter("100");
    setResolutionHours("");
    setQuestionType("views");
    setAnchorMilestone(null);
    setAnchorHours(null);
    setTitleValue("");
    setLiveProbability(null);
    setIsFetchingSuggestion(false);

    if (!videoUrl.trim()) return;

    // Phase 1: fetch video stats
    let statsResult: VideoStatsData | null = null;
    try {
      setIsFetchingStats(true);
      const result = await fetchVideoStats(videoUrl);
      if (token.canceled) return;
      setIsFetchingStats(false);

      if ("error" in result) {
        setError(result.error ?? "Unknown error");
        return;
      }
      statsResult = result;
      setVideoStats(result);
    } catch (err) {
      if (token.canceled) return;
      setError(err instanceof Error ? err.message : "Failed to fetch video");
      return;
    } finally {
      if (!token.canceled) setIsFetchingStats(false);
    }

    // Phase 2: generate contract suggestion
    setIsFetchingSuggestion(true);
    try {
      const suggestionResult = await fetchMarketSuggestion({
        videoId: statsResult.videoId,
        title: statsResult.title,
        channelTitle: statsResult.channelTitle,
        publishedAt: statsResult.publishedAt,
        viewCount: statsResult.viewCount,
        likeCount: statsResult.likeCount,
      });
      if (token.canceled) return;

      if ("error" in suggestionResult) {
        // Non-blocking: unlock controls with defaults so admin can fill in manually
        setAnchorMilestone(statsResult.viewCount || 1);
        setAnchorHours(48);
        return;
      }

      const { contract } = suggestionResult;
      if (contract) {
        setAnchorMilestone(contract.milestoneThreshold);
        setAnchorHours(contract.resolutionHours);
        setMilestoneThreshold(String(contract.milestoneThreshold));
        setResolutionHours(String(contract.resolutionHours));
        setBParameter(String(contract.bParameter));
        setRiskTier(contract.riskTier);
        if (isLLMRecommendation(contract)) {
          setTitleValue(contract.suggestedTitle);
          setQuestionType(contract.questionTypeRecommendation);
        }
      } else {
        // Null contract: unlock with defaults
        setAnchorMilestone(statsResult.viewCount || 1);
        setAnchorHours(48);
      }
    } catch {
      if (token.canceled) return;
      // Suggestion failed — unlock controls with defaults
      setAnchorMilestone(statsResult.viewCount || 1);
      setAnchorHours(48);
    } finally {
      if (!token.canceled) setIsFetchingSuggestion(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    startTransition(async () => {
      const formData = new FormData(e.currentTarget);
      formData.set("videoUrl", videoUrl);
      formData.set("publishImmediately", "true");

      const result = await createMarket(formData);
      if ("error" in result) {
        setError(result.error ?? "Unknown error");
      } else {
        router.push("/admin/markets");
      }
    });
  }

  // Slider moves milestone only — resolution window is independent (one-way binding).
  function handleMilestoneSlider(rawValue: string) {
    const value = Math.round(Number(rawValue));
    setMilestoneThreshold(String(value));
  }

  function handleResolutionButton(hours: number) {
    setResolutionHours(String(hours));
    if (anchorMilestone !== null && anchorHours !== null) {
      const raw = Math.round(anchorMilestone * (hours / anchorHours));
      setMilestoneThreshold(String(Math.max(milestoneFloor, raw)));
    }
  }

  const publishDisabled =
    isFetchingStats ||
    isFetchingSuggestion ||
    isPending ||
    !videoStats ||
    !milestoneThreshold ||
    !resolutionHours;

  const videoAgeHours = videoStats
    ? Math.max((Date.now() - new Date(videoStats.publishedAt).getTime()) / 3_600_000, 0.1)
    : 0;

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-6">Create New Market</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Video URL */}
        <div>
          <label className="block text-sm font-medium mb-1.5">TikTok Video URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleFetchVideo();
                }
              }}
              placeholder="https://www.tiktok.com/@creator/video/..."
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleFetchVideo}
              disabled={isFetchingStats || isFetchingSuggestion}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {isFetchingStats ? "Fetching…" : isFetchingSuggestion ? "Generating…" : "Fetch"}
            </button>
          </div>
        </div>

        {/* Video preview */}
        {videoStats && (
          <div className="flex gap-3 p-3 bg-card border border-border rounded-lg">
            <img
              src={videoStats.thumbnail}
              alt={videoStats.title}
              className="w-24 h-auto rounded"
            />
            <div className="text-sm flex-1 min-w-0">
              <div className="font-medium truncate">{videoStats.title}</div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-muted">{videoStats.channelTitle}</span>
                {riskTier && <RiskBadge tier={riskTier} />}
                {liveProbability !== null && <ProbabilityBadge probability={liveProbability} />}
              </div>
            </div>
          </div>
        )}

        {/* Stats panel */}
        {videoStats && (
          <MarketStatsPanel
            viewCount={videoStats.viewCount}
            likeCount={videoStats.likeCount}
            videoAgeHours={videoAgeHours}
            subscriberCount={null}
            channelAvgViews={null}
          />
        )}

        {/* Hidden inputs so createMarket can read metadata without re-fetching */}
        <input type="hidden" name="videoTitle" value={videoStats?.title ?? ""} />
        <input type="hidden" name="thumbnail" value={videoStats?.thumbnail ?? ""} />
        <input type="hidden" name="channelTitle" value={videoStats?.channelTitle ?? ""} />
        <input type="hidden" name="creatorId" value={videoStats?.creatorId ?? ""} />
        <input type="hidden" name="tikapiPostId" value={videoStats?.tikapiPostId ?? ""} />
        <input type="hidden" name="videoDescription" value={videoStats?.description ?? ""} />
        <input type="hidden" name="playUrl" value={videoStats?.playUrl ?? ""} />
        <input type="hidden" name="initialViewCount" value={videoStats?.viewCount ?? ""} />
        <input type="hidden" name="initialLikeCount" value={videoStats?.likeCount ?? ""} />
        <input type="hidden" name="publishedAt" value={videoStats?.publishedAt ?? ""} />
        <input type="hidden" name="channelAvgViews" value="" />

        {/* Market title — editable */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Market Title</label>
          <input
            name="title"
            type="text"
            required
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            placeholder='e.g. "Will this TikTok hit 500K views in 48h?"'
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Description (optional)</label>
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
            <label className="block text-sm font-medium mb-1.5">Question Type</label>
            <select
              name="questionType"
              required
              value={questionType}
              onChange={(e) => setQuestionType(e.target.value as "views" | "likes")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="views">View milestone</option>
              <option value="likes">Like milestone</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Milestone Target</label>
            <input type="hidden" name="milestoneThreshold" value={milestoneThreshold} />
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-xs text-muted">
                <span>{contractLoaded ? milestoneFloor.toLocaleString() : "–"}</span>
                <span className="text-sm font-semibold text-foreground">
                  {milestoneThreshold ? Number(milestoneThreshold).toLocaleString() : "–"}
                </span>
                <span>{contractLoaded ? milestoneMax.toLocaleString() : "–"}</span>
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
              {videoStats && contractLoaded && (
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
            <label className="block text-sm font-medium mb-1.5">Resolution Window</label>
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
            <label className="block text-sm font-medium mb-1.5">Liquidity (b)</label>
            <input
              name="bParameter"
              type="number"
              min="1"
              max="1000"
              value={bParameter}
              onChange={(e) => setBParameter(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-muted mt-1">Higher = more stable prices. Max loss ≈ b × 0.69</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red/10 border border-red/20 rounded-lg text-sm text-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={publishDisabled}
          className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {isPending ? "Publishing…" : "Publish"}
        </button>
      </form>
    </div>
  );
}
