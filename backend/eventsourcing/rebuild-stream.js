import { applyEvent, normalizeEventRow } from './event-sourcing-core.js';

/** Consume aggregate/version-ordered pages without retaining event history. */
export async function rebuildFromPages({ orderPages, driverPages, getSnapshot, writeOrder, writeDriver }) {
  let aggregateId;
  let state;
  let snapshotVersion = 0;
  let lastEventType;
  let hasState = false;
  const counts = { aggregates: 0, orderCount: 0, driverCount: 0, eventCount: 0 };

  const flush = async () => {
    if (aggregateId !== undefined && hasState) {
      await writeOrder(aggregateId, state, lastEventType, state.version);
      counts.orderCount += 1;
    }
  };

  for await (const page of orderPages) {
    for (const row of page) {
      counts.eventCount += 1;
      const event = normalizeEventRow(row);
      if (!event) continue;
      if (event.aggregateId !== aggregateId) {
        await flush();
        aggregateId = event.aggregateId;
        const snapshot = await getSnapshot(aggregateId);
        snapshotVersion = snapshot ? Number(snapshot.version) : 0;
        state = snapshot ? { ...snapshot.state } : { id: aggregateId, version: 0 };
        hasState = Boolean(snapshot);
        counts.aggregates += 1;
      }
      lastEventType = event.type;
      if (Number(event.version) > snapshotVersion) {
        state = applyEvent(state, event);
        hasState = true;
      }
    }
  }
  await flush();

  // Preserve global assignment chronology, independent of aggregate grouping.
  for await (const page of driverPages) {
    for (const row of page) {
      const event = normalizeEventRow(row);
      if (event?.type !== 'DRIVER_ASSIGNED') continue;
      await writeDriver(event);
      counts.driverCount += 1;
    }
  }
  return counts;
}
