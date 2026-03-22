"use client";

import { useState, useEffect } from "react";

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Ended";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export function CountdownTimer({ target }: { target: Date }) {
  const [remaining, setRemaining] = useState(
    target.getTime() - Date.now()
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(target.getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [target]);

  const isUrgent = remaining > 0 && remaining < 1000 * 60 * 60; // < 1 hour

  return (
    <span
      className={`text-sm ${isUrgent ? "text-red font-medium" : "text-muted"}`}
    >
      {remaining > 0 ? `${formatTimeRemaining(remaining)} remaining` : "Ended"}
    </span>
  );
}
