export async function flush({ db, publisher } = {}) {
  const events = await db.getPendingEvents();
  if (!events || !events.length) {
    return;
  }
  for (const event of events) {
    try {
      await publisher.publishAndReport(event);
      await db.markPublished(event.event_id);
    } catch (err) {
      await db.markFailed(event.event_id, err);
    }
  }
}

export default {
  flush,
};
