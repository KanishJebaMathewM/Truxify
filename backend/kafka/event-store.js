// Stub for spec 38
// === Spec 38: stream cursor ===
export async function* iterateEventsInChunks(client, n = 100) {
  let off = 0;
  while (true) {
    const r = await client.query('SELECT * FROM events ORDER BY sequence_nr LIMIT $1 OFFSET $2', [n, off]);
    if (!r || r.length === 0) break;
    for (const x of r) yield x;
    if (r.length < n) break;
    off += n;
  }
}

