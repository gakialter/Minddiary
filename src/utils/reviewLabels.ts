/**
 * UI mapping for SM-2 review quality ratings.
 * Separated from spacedRepetition.ts (pure algorithm) to keep UI concerns distinct.
 */
export const REVIEW_QUALITIES = [
  { quality: 0, label: '重来', color: 'var(--danger)',  icon: 'RotateCcw' },
  { quality: 2, label: '困难', color: 'var(--warning)', icon: 'AlertTriangle' },
  { quality: 4, label: '良好', color: 'var(--success)', icon: 'Check' },
  { quality: 5, label: '简单', color: 'var(--accent)',  icon: 'Zap' },
] as const
