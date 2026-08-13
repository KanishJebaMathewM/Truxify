// Stub for spec 36
// === Spec 36: sort by sequence ===
export function sortBySequence(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => (a.sequenceNr ?? 0) - (b.sequenceNr ?? 0));
}

