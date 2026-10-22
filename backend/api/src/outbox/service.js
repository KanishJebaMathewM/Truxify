export async function publish(payload, { db } = {}) {
  const event = {
    ...payload,
    status: 'pending',
  };
  return await db.writeEvent(event);
}

export default {
  publish,
};
