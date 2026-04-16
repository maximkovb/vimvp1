"use client";

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
  return (
    <div className="space-y-1">
      <div className="text-center py-1">
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        <span className="text-sm text-muted ml-1.5">coins</span>
      </div>
      <div className="py-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ height: "44px", cursor: disabled ? "not-allowed" : "pointer" }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted px-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
