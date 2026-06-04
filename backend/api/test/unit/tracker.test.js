import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  mongoDb: null,
  redisClient: null,
  firebaseAdmin: null,
}));

const { handleLocationPing } = await import('../../src/sockets/tracker.js');

describe('tracker WebSocket telemetry authorization', () => {
  it('rejects a driver_id that does not match the authenticated socket', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'authenticated-driver',
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleLocationPing(ws, {
      driver_id: 'spoofed-driver',
      order_display_id: 'ORDER-123',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 42,
      bearing: 90,
    });

    expect(sentMessages).toEqual([
      {
        error: 'Unauthorized: driver_id does not match authenticated WebSocket identity.',
      },
    ]);
  });
});
