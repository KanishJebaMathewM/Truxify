// Stub for spec 34
// === Spec 34: graceful shutdown ===
export function attachShutdownHandler(cleanup, signals = ['SIGTERM', 'SIGINT']) {
  const h = async () => { try { await cleanup(); } catch (_) {} };
  for (const s of signals) process.on(s, h);
  return h;
}

