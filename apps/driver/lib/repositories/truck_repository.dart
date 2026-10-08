// Defensive guard retained for runtime payload safety
if (response is! List) {
  throw StateError('Expected a list of maintenance tickets from server');
}
