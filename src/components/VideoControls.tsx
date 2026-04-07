"use client";

import type React from "react";

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

interface VideoControlsProps {
  isPaused: boolean;
  isMuted: boolean;
  currentTime: number;
  duration: number;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Stop click from bubbling to a parent tap handler */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function VideoControls({
  isPaused,
  isMuted,
  currentTime,
  duration,
  onTogglePause,
  onToggleMute,
  onSeek,
  onClick,
}: VideoControlsProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-1.5" onClick={onClick}>
      {/* Progress bar */}
      <div
        className="w-full h-1 rounded-full bg-white/30 cursor-pointer"
        onClick={onSeek}
      >
        <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
      </div>

      {/* Play/pause + mute */}
      <div className="flex items-center justify-between">
        <button
          onClick={onTogglePause}
          aria-label={isPaused ? "Play" : "Pause"}
          className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
        >
          {isPaused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
        >
          {isMuted ? <MutedIcon /> : <UnmutedIcon />}
        </button>
      </div>
    </div>
  );
}
