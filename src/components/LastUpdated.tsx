"use client";

import { useState, useEffect } from "react";

interface LastUpdatedProps {
  updatedAt: Date;
}

function formatAge(seconds: number): string {
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ago`;
}

export function LastUpdated({ updatedAt }: LastUpdatedProps) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    setAge(Math.floor((Date.now() - updatedAt.getTime()) / 1000));

    const id = setInterval(() => {
      setAge(Math.floor((Date.now() - updatedAt.getTime()) / 1000));
    }, 10_000);

    return () => clearInterval(id);
  }, [updatedAt]);

  return (
    <span className="text-xs text-muted">Updated {formatAge(age)}</span>
  );
}
