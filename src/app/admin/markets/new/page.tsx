"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoStats, generateMarketSuggestion, createMarket } from "@/lib/actions/admin";
import type { VideoStatsSuccess, SuggestionSuccess } from "@/lib/actions/admin";
import type { RiskTier, ContractRecommendation, LLMContractRecommendation } from "@/lib/contract";
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

// Derived from action return types — stays in sync automatically when actions evolve.
type VideoStatsData = VideoStatsSuccess;
type SuggestionData = SuggestionSuccess;

export default function CreateMarketPage() {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");

  // Phase 1 state
  const [videoStats, setVideoStats] = useState<VideoStatsData | null>(null);
  const [isFetchingStats, setIsFetchingStats] = useState(false);

  // Phase 2 state
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null);
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);

  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Contract fields — controlled so they can be auto-populated from analytics
  const [milestoneThreshold, setMilestoneThreshold] = useState("");
  const [bParameter, setBParameter] = useState("100");
  const [resolutionHours, setResolutionHours] = useState("");
  const [riskTier, setRiskTier] = useState<RiskTier | null>(null);
  const [questionType, setQuestionType] = useState<"views" | "likes">("views");
  const [titleValue, setTitleValue] = useState("");

  // Live probability — updated on any override after suggestion loads
  const [liveProbability, setLiveProbability] = useState<number | null>(null);

  // Anchor — original AI recommendation used as fixed reference for proportional adjustments
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
  // Soft UI max for slider drag range only — not a hard ceiling.
  // Admin can type any value; the live probability display is the guardrail.
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
  // Passes channelAvgViews so the display uses the channel-baseline-floor formula,
  // matching the same calibration model used by both generation paths.
  useEffect(() => {
    if (!suggestion || !milestoneThreshold || !resolutionHours) return;
    const prob = computeProbability(
      currentAnalytics,
      suggestion.videoAgeHours,
      Number(resolutionHours),
      Number(milestoneThreshold),
      suggestion.channelAvgViews
    );
    setLiveProbability(prob);
  }, [milestoneThreshold, resolutionHours, currentAnalytics, suggestion]);

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
    setSuggestion(null);
    setRiskTier(null);
    setMilestoneThreshold("");
    setBParameter("100");
    setResolutionHours("");
    setQuestionType("views");
    setAnchorMilestone(null);
    setAnchorHours(null);
    setTitleValue("");
    setLiveProbability(null);

    if (!videoUrl.trim()) return;

    try {
      // Phase 1: fast video stats (~500ms)
      setIsFetchingStats(true);
      const statsResult = await fetchVideoStats(videoUrl);
      if (token.canceled) return;
      setIsFetchingStats(false);

      if ("error" in statsResult) {
        setError(statsResult.error ?? "Unknown error");
        return;
      }
      setVideoStats(statsResult);

      // Phase 2: channel analytics + market suggestion (~5–15s)
      setIsGeneratingSuggestion(true);
      const suggestionResult = await generateMarketSuggestion({
        videoId: statsResult.videoId,
        title: statsResult.title,
        channelId: statsResult.channelId,
        channelTitle: statsResult.channelTitle,
        publishedAt: statsResult.publishedAt,
        categoryId: statsResult.categoryId,
        viewCount: statsResult.viewCount,
        likeCount: statsResult.likeCount,
      });
      if (token.canceled) return;
      setIsGeneratingSuggestion(false);

      if ("error" in suggestionResult) {
        setError(suggestionResult.error ?? "Unknown error");
        return;
      }
      setSuggestion(suggestionResult);

      if (suggestionResult.contract) {
        const aiMilestone = suggestionResult.contract.milestoneThreshold;
        const clampedMilestone = computeMilestoneFloor(aiMilestone, statsResult.viewCount);
        const safeResolutionHours = suggestionResult.contract.resolutionHours;
        setMilestoneThreshold(String(clampedMilestone));
        setBParameter(String(suggestionResult.contract.bParameter));
        setResolutionHours(String(safeResolutionHours));
        setRiskTier(suggestionResult.contract.riskTier);
        // Anchor is the raw AI suggestion — used as reference for proportional scaling.
        // The initial displayed value may be floor-clamped, but the anchor stays at AI intent.
        setAnchorMilestone(aiMilestone);
        setAnchorHours(safeResolutionHours);
        if (isLLMRecommendation(suggestionResult.contract)) {
          const rec = suggestionResult.contract.questionTypeRecommendation;
          setQuestionType(rec === "likes" ? "likes" : "views");
        }
      }

      if (suggestionResult.suggestedTitle) {
        setTitleValue(suggestionResult.suggestedTitle);
      }
    } catch (err) {
      if (token.canceled) return;
      setError(err instanceof Error ? err.message : "Failed to fetch video");
    } finally {
      if (!token.canceled) {
        setIsFetchingStats(false);
        setIsGeneratingSuggestion(false);
      }
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
  // Selecting a resolution button will proportionally update the milestone, but not vice versa.
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

  const llmContract =
    suggestion?.contract && isLLMRecommendation(suggestion.contract)
      ? suggestion.contract
      : null;

  const publishDisabled =
    isFetchingStats ||
    isGeneratingSuggestion ||
    isPending ||
    !videoStats ||
    !milestoneThreshold ||
    !resolutionHours;

  // videoAgeHours for the stats panel: use server-computed value once available,
  // otherwise derive from publishedAt so the panel renders immediately after Phase 1
  const videoAgeHours =
    suggestion?.videoAgeHours ??
    (videoStats
      ? Math.max((Date.now() - new Date(videoStats.publishedAt).getTime()) / 3_600_000, 0.1)
      : 0);

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-6">Create New Market</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Video URL */}
        <div>
          <label className="block text-sm font-medium mb-1.5">YouTube Video URL</label>
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
              placeholder="https://youtube.com/shorts/..."
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleFetchVideo}
              disabled={isFetchingStats}
              className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {isFetchingStats ? "Fetching…" : "Fetch"}
            </button>
          </div>
        </div>

        {/* Video preview */}
        {videoStats && (
          <div className="flex gap-3 p-3 bg-card border border-border rounded-lg">
            <img
              src={videoStats.thumbnail}
              alt={videoStats.title}
              className="w-32 h-auto rounded"
            />
            <div className="text-sm flex-1 min-w-0">
              <div className="font-medium truncate">{videoStats.title}</div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-muted">{videoStats.channelTitle}</span>
                {riskTier && <RiskBadge tier={riskTier} />}
                {liveProbability !== null && <ProbabilityBadge probability={liveProbability} />}
              </div>
              {isGeneratingSuggestion && (
                <div className="mt-2 text-xs text-muted animate-pulse">
                  Generating market suggestion…
                </div>
              )}
              {llmContract && (
                <div className="mt-3 p-3 bg-muted/40 rounded-md border border-border/50">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    AI Analysis
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {llmContract.reasoning}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats panel — visible after Phase 1; skeleton cells fill in after Phase 2 */}
        {videoStats && (
          <MarketStatsPanel
            viewCount={videoStats.viewCount}
            likeCount={videoStats.likeCount}
            videoAgeHours={videoAgeHours}
            subscriberCount={suggestion ? suggestion.subscriberCount : null}
            channelAvgViews={suggestion ? suggestion.channelAvgViews : null}
          />
        )}

        {/* Duplicate warning */}
        {suggestion?.duplicateWarning && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-600">
            An active or draft market already exists for this video. You can still publish a new one.
          </div>
        )}

        {/* Hidden inputs so createMarket can read metadata without re-fetching */}
        <input type="hidden" name="videoTitle" value={videoStats?.title ?? ""} />
        <input type="hidden" name="thumbnail" value={videoStats?.thumbnail ?? ""} />
        <input type="hidden" name="channelTitle" value={videoStats?.channelTitle ?? ""} />
        <input type="hidden" name="channelId" value={videoStats?.channelId ?? ""} />
        <input type="hidden" name="videoDescription" value={videoStats?.description ?? ""} />
        <input type="hidden" name="initialViewCount" value={videoStats?.viewCount ?? ""} />
        <input type="hidden" name="initialLikeCount" value={videoStats?.likeCount ?? ""} />
        <input type="hidden" name="publishedAt" value={videoStats?.publishedAt ?? ""} />
        <input type="hidden" name="channelAvgViews" value={suggestion?.channelAvgViews ?? ""} />

        {/* Market title — pre-populated from AI suggestion, editable */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Market Title</label>
          <input
            name="title"
            type="text"
            required
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            placeholder='e.g. "Will this Short hit 500K views in 48h?"'
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
