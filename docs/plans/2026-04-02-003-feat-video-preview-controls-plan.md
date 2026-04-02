---
title: "feat: Video Preview Controls — Mute Toggle, Pause, and TikTok Link"
type: feat
status: completed
date: 2026-04-02
---

# feat: Video Preview Controls — Mute Toggle, Pause, and TikTok Link

Add interactive controls to the native video player in `TikTokEmbed`: a mute/unmute toggle, click-to-pause/resume, and a "View on TikTok" link below the player. Controls only apply to the `<video>` path (when `currentPlayUrl` is set); the iframe fallback is left unchanged.

## Acceptance Criteria

- [ ] Clicking the video area pauses/resumes playback; visual indicator updates accordingly
- [ ] A mute/unmute button overlays the video; starts muted (matching current `autoPlay muted` behavior)
- [ ] Setting `muted` imperatively via `videoRef.current.muted` rather than toggling the React prop (avoids re-mount on `key`)
- [ ] A "View on TikTok" link appears below the video wrapper, opening in a new tab
- [ ] All controls appear only on the `currentPlayUrl` (`<video>`) path — iframe fallback unchanged
- [ ] No hydration mismatch: no new server-rendered attributes that differ client-side

## Context

**Only file to change:** `src/components/TikTokEmbed.tsx` (61 lines).

Current state:
- `<video>` has hardcoded `autoPlay muted loop playsInline` — no ref, no controls (lines 38–48)
- `useState` is already imported; `useRef` is not yet imported
- No icon library installed; inline SVG is the right approach

**Browser autoplay policy:** Videos must start `muted` to autoplay. Unmuting requires a user gesture (click). This is already satisfied since mute state starts `true`.

**`play()` returns a Promise** that can reject with `AbortError` if interrupted. Must `catch` it silently.

## Implementation

### `src/components/TikTokEmbed.tsx`

```tsx
"use client";

import { useRef, useState } from "react";

// ... same props interface ...

export function TikTokEmbed({ videoId, title, playUrl, thumbnail }: TikTokEmbedProps) {
  const [currentPlayUrl, setCurrentPlayUrl] = useState(playUrl ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ... handleVideoError unchanged ...

  function toggleMute() {
    if (!videoRef.current) return;
    const next = !isMuted;
    videoRef.current.muted = next;
    setIsMuted(next);
  }

  function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {}); // absorb AbortError
      setIsPaused(false);
    } else {
      video.pause();
      setIsPaused(true);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* 9:16 aspect ratio wrapper */}
      <div className="relative w-full" style={{ paddingBottom: "177.78%" }}>
        {currentPlayUrl ? (
          <>
            <video
              ref={videoRef}
              key={currentPlayUrl}
              src={currentPlayUrl}
              poster={thumbnail ?? undefined}
              autoPlay
              muted          // initial attribute; thereafter controlled via ref
              loop
              playsInline
              title={title ?? "TikTok video"}
              className="absolute inset-0 w-full h-full object-cover rounded-xl cursor-pointer"
              onError={handleVideoError}
              onClick={togglePause}
            />
            {/* Pause indicator overlay */}
            {isPaused && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                {/* Play icon */}
                <svg .../>
              </div>
            )}
            {/* Mute toggle — bottom-right corner */}
            <button
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="absolute bottom-3 right-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
          </>
        ) : (
          <iframe ... /> // unchanged
        )}
      </div>

      {/* TikTok link — below the video */}
      <a
        href={`https://www.tiktok.com/@/video/${videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-accent hover:underline self-end"
      >
        View on TikTok ↗
      </a>
    </div>
  );
}
```

**SVG icons to inline** (no icon library; keep them small, ~20×20 viewBox):
- Muted: speaker with X or strikethrough lines
- Unmuted: speaker with sound waves
- Play (pause indicator): right-pointing triangle

**TikTok URL:** `https://www.tiktok.com/@/video/${videoId}` — the `@/` (empty username) causes a redirect to the canonical URL on TikTok's CDN. Alternatively use `https://vm.tiktok.com/${videoId}` if the above doesn't redirect reliably; verify before shipping.

## Sources

- Component to modify: `src/components/TikTokEmbed.tsx`
- Toggle button pattern: `src/components/VideoDescription.tsx:25-32`
- CSS variables: `src/app/globals.css:1-27`
- Video ID constant: `src/lib/constants.ts` (`TIKTOK_VIDEO_ID_RE`)
