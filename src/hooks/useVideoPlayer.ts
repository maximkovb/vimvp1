import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";

export function useVideoPlayer(videoId: string, isActive: boolean) {
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState(false);
  // Prevents mounting <video> until the card is first activated, so all cards
  // don't fire concurrent stream requests on initial page load.
  const [hasActivated, setHasActivated] = useState(false);

  // Mutable ref to the live DOM element — used by effects and imperative callbacks.
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Stable ref to the current isActive value. Safe to read from callbacks that
  // have empty deps (e.g. setVideoRef) without causing stale-closure bugs.
  const isActiveRef = useRef(isActive);
  useLayoutEffect(() => {
    isActiveRef.current = isActive;
  });

  // The browser always streams through our proxy — URL freshness handled server-side.
  const streamSrc = `/api/tiktok/${videoId}/stream`;

  // Attempt unmuted play, falling back to muted autoplay if the browser blocks it.
  function attemptPlay(video: HTMLVideoElement) {
    video.muted = false;
    setIsMuted(false);
    video.play().catch(() => {
      // Browser autoplay policy: unmuted play rejected — retry muted.
      video.muted = true;
      setIsMuted(true);
      video.play().catch(() => {});
    });
  }

  // Callback ref passed to <video ref={setVideoRef}>.
  // When the video element mounts (after hasActivated flips true), if the card is
  // already active we start playing immediately. This bridges the timing gap where
  // the playback effect already ran with videoRef.current === null.
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && isActiveRef.current) {
      attemptPlay(el);
      setIsPaused(false);
    }
  }, []); // stable — reads isActive via ref, not closure

  // Mark as activated and reset any prior load error when card becomes active.
  useEffect(() => {
    if (isActive) {
      setHasActivated(true);
      setLoadError(false);
    }
  }, [isActive]);

  // Drive play/pause from isActive changes after the video is already mounted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return; // video not mounted yet — setVideoRef handles that case

    if (isActive) {
      attemptPlay(video);
      setIsPaused(false);
    } else {
      video.pause();
      video.muted = true;
      setIsMuted(true);
      setIsPaused(true);
    }
  }, [isActive]);

  function toggleMute() {
    const video = videoRef.current;
    const next = video ? !video.muted : !isMuted;
    if (video) video.muted = next;
    setIsMuted(next);
  }

  function togglePause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPaused(false);
    } else {
      video.pause();
      setIsPaused(true);
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
  }

  const videoEvents = {
    onPause: () => setIsPaused(true),
    onPlay: () => setIsPaused(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) =>
      setCurrentTime(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) =>
      setDuration(e.currentTarget.duration),
    onError: () => setLoadError(true),
  };

  return {
    streamSrc,
    hasActivated,
    loadError,
    isMuted,
    isPaused,
    currentTime,
    duration,
    setVideoRef,
    toggleMute,
    togglePause,
    handleSeek,
    videoEvents,
  };
}
