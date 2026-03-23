"use client";

import { useState } from "react";

const TRUNCATE_AT = 300;

interface VideoDescriptionProps {
  description: string;
}

export function VideoDescription({ description }: VideoDescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!description) return null;

  const isLong = description.length > TRUNCATE_AT;
  const displayText =
    isLong && !expanded ? description.slice(0, TRUNCATE_AT) + "…" : description;

  return (
    <div>
      <p className="text-sm text-muted whitespace-pre-line">{displayText}</p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-accent hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
