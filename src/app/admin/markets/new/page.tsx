"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchVideoMetadata, createMarket } from "@/lib/actions/admin";

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
  } | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleFetchVideo() {
    setError("");
    setVideoPreview(null);
    if (!videoUrl) return;

    const result = await fetchVideoMetadata(videoUrl);
    if ("error" in result) {
      setError(result.error ?? "Unknown error");
    } else {
      setVideoPreview(result);
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
            <div className="text-sm">
              <div className="font-medium">{videoPreview.title}</div>
              <div className="text-muted">{videoPreview.channelTitle}</div>
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
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72" selected>
                72 hours
              </option>
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
              defaultValue="100"
              min="1"
              max="1000"
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
