"use client";

import { useRef } from "react";

const SNAP_POINTS = [
  { pct: 0.10, label: "10%" },
  { pct: 0.25, label: "25%" },
  { pct: 0.50, label: "50%" },
  { pct: 0.75, label: "75%" },
  { pct: 1.00, label: "100%" },
];

interface CoinSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function CoinSlider({
  value,
  onChange,
  min = 1,
  max = 500,
  disabled = false,
}: CoinSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  function valueFromPointer(clientX: number): number {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(min, Math.min(max, Math.round(ratio * max)));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(valueFromPointer(e.clientX));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current || disabled) return;
    onChange(valueFromPointer(e.clientX));
  }

  function handlePointerUp() {
    isDragging.current = false;
  }

  function handleSnapClick(pct: number) {
    if (disabled) return;
    onChange(Math.max(min, Math.round(pct * max)));
  }

  const ballPct = max > 0 ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className={disabled ? "opacity-50 pointer-events-none" : ""}>
      {/* Track area — includes padding for touch target */}
      <div
        ref={trackRef}
        className="relative flex items-center cursor-pointer"
        style={{ height: "44px" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Line */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-border rounded-full" />

        {/* Draggable ball */}
        <div
          className="absolute w-4 h-4 rounded-full bg-accent shadow-sm -translate-x-1/2 -translate-y-1/2 top-1/2"
          style={{ left: `${ballPct}%` }}
        />
      </div>

      {/* Snap point markers */}
      <div className="relative mt-1" style={{ height: "20px" }}>
        {SNAP_POINTS.map(({ pct, label }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => handleSnapClick(pct)}
            className="absolute flex flex-col items-center -translate-x-1/2 disabled:cursor-not-allowed"
            style={{ left: `${pct * 100}%` }}
          >
            <div
              className={`w-1 h-1 rounded-full mb-0.5 ${
                value >= Math.max(min, Math.round(pct * max))
                  ? "bg-accent"
                  : "bg-muted"
              }`}
            />
            <span className="text-[10px] text-muted leading-none whitespace-nowrap">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
