'use client';
import { useState } from 'react';
import { deriveResolutionRules } from '@/lib/resolution-rules';
import type { MarketData } from '@/types/market';

export function ResolutionRulesAccordion({ market }: { market: MarketData }) {
  const [open, setOpen] = useState(false);

  if (market.status === 'cancelled' || market.status === 'failed') return null;

  const rules = deriveResolutionRules(market);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-muted text-xs leading-snug">{rules.yesCondition}</span>
        <span
          className={`text-muted ml-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      <div
        className={`transition-[max-height] duration-200 ease-in-out overflow-hidden ${
          open ? 'max-h-96' : 'max-h-0'
        }`}
      >
        <div className="px-4 pb-4 flex flex-col gap-2 text-xs border-t border-border">
          <div className="flex justify-between gap-4 pt-3">
            <span className="text-muted/60 shrink-0">YES condition</span>
            <span className="text-muted text-right">{rules.yesCondition}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted/60 shrink-0">NO condition</span>
            <span className="text-muted text-right">{rules.noCondition}</span>
          </div>
          {rules.deadline && (
            <div className="flex justify-between gap-4">
              <span className="text-muted/60 shrink-0">Deadline</span>
              <span className="text-muted text-right">{rules.deadline}</span>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-muted/60 shrink-0">Data source</span>
            <span className="text-muted text-right">{rules.dataSource}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
