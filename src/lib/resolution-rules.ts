import { formatCount } from './format';
import type { MarketData } from '@/types/market';

export interface ResolutionRules {
  yesCondition: string;
  noCondition: string;
  dataSource: string;
  deadline: string | null;
}

export function deriveResolutionRules(
  market: Pick<MarketData, 'milestoneThreshold' | 'resolvesAt' | 'questionType'>
): ResolutionRules {
  const count = formatCount(Number(market.milestoneThreshold) || 0);
  const metric = market.questionType;
  const dataSource =
    market.questionType === 'likes'
      ? 'TikTok public like count'
      : 'TikTok public view count';

  let deadline: string | null = null;
  if (market.resolvesAt) {
    const parsed = Date.parse(market.resolvesAt);
    if (!isNaN(parsed)) {
      deadline = new Date(parsed).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    }
  }

  const yesCondition = deadline
    ? `Resolves YES if video reaches ${count} ${metric} before ${deadline}.`
    : `Resolves YES if video reaches ${count} ${metric} before market closes.`;
  const noCondition = deadline
    ? `Resolves NO if the milestone is not reached by ${deadline}.`
    : `Resolves NO if the milestone is not reached before market closes.`;

  return { yesCondition, noCondition, dataSource, deadline };
}
