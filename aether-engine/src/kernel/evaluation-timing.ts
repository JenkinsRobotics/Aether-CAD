/** Optional local diagnostics. These events are never part of a saved model. */
export type EvaluationTiming =
  | { phase: 'feature'; id: string; name: string; type: string; milliseconds: number; failed: boolean }
  | { phase: 'display'; id: string; milliseconds: number; cached: boolean };

export type EvaluationObserver = (event: EvaluationTiming) => void;
