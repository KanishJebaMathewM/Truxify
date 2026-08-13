// Stub for spec 37
// === Spec 37: sequence continuity ===
export class SequenceGapError extends Error {
  constructor(e, g) { super(`Expected ${e} got ${g}`); this.name = 'SequenceGapError'; }
}
export function assertContinuity(last, next) {
  if (next !== last + 1) throw new SequenceGapError(last + 1, next);
  return next;
}

