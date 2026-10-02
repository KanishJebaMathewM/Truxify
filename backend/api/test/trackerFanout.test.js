import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../src/config/db.js', () => ({ mongoDb: null, redisClient: null, firebaseAdmin: null, supabase: null, supabaseAdmin: null }));
vi.mock('../src/models/GpsLog.js', () => ({ default: {} }));
vi.mock('../src/services/order/etaService.js', () => ({ scheduleEtaRecalculationOnLocationUpdate: vi.fn() }));
vi.mock('../src/services/order/deliveryDelayService.js', () => ({ default: class {} }));
vi.mock('../src/sockets/telemetryBuffer.js', () => ({ default: { _test: {} } }));
vi.mock('../src/sockets/adaptivePoller.js', () => ({ calculateAdaptiveInterval: vi.fn(), getQueueDepth: vi.fn() }));
const { fanoutTrackingPayload, trackingBufferLimit } = await import('../src/sockets/trackingFanout.js');
const tracker = await import('../src/sockets/tracker.js');
const socket = (overrides = {}) => ({ readyState: 1, bufferedAmount: 0, send: vi.fn(), terminate: vi.fn(), ...overrides });
afterEach(() => { vi.unstubAllEnvs(); tracker.__testing.resetTrackingSubscriptions(); });
const event = { sourceInstanceId: 'other', driverId: 'driver', orderDisplayId: 'order', location: { lat: 12, lng: 77 }, timestamp: '2026-10-02T00:00:00.000Z' };

for (const mode of ['location', 'milestone', 'eta']) {
  describe(`${mode} actual tracker fanout`, () => {
    const dispatch = (clients, metrics = { recordDelivery: vi.fn(), getInstanceId: () => 'local' }) => {
      const map = new Map([['order', new Set(clients)], ['driver', new Set(clients)]]);
      tracker.__testing.setTrackingSubscriptions(map);
      if (mode === 'location') tracker.__testing.createLocationEventHandler(metrics, map)(event);
      else if (mode === 'milestone') tracker.broadcastOrderMilestone('order', 'picked_up', 'in_transit');
      else tracker.broadcastOrderEta('order', { minutes: 5 });
      return metrics;
    };
    it('a throwing socket cannot stop a healthy next subscriber', () => {
      const bad = socket({ send: vi.fn(() => { throw new Error('transport'); }) }), good = socket();
      const metrics = dispatch([bad, good]);
      expect(good.send).toHaveBeenCalledTimes(1); expect(bad.terminate).toHaveBeenCalledTimes(1);
      if (mode === 'location') expect(metrics.recordDelivery).toHaveBeenCalledWith(1);
    });
    it('over-budget and closed sockets do not displace healthy delivery', () => {
      const slow = socket({ bufferedAmount: 1024 * 1024 }), closed = socket({ readyState: 3 }), good = socket();
      const metrics = dispatch([slow, closed, good]);
      expect(slow.send).not.toHaveBeenCalled(); expect(slow.terminate).toHaveBeenCalledTimes(1);
      expect(closed.send).not.toHaveBeenCalled(); expect(good.send).toHaveBeenCalledTimes(1);
      if (mode === 'location') expect(metrics.recordDelivery).toHaveBeenCalledWith(1);
    });
    it('keeps the existing wire event and one send for normal subscribers', () => {
      const good = socket(); dispatch([good]);
      expect(good.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(good.send.mock.calls[0][0]).event).toBe(mode === 'location' ? 'location_update' : `${mode}_update`);
    });
  });
}

describe('queue admission and callback ownership', () => {
  it.each([undefined, '', 0, -1, NaN, Infinity, 'invalid'])('normalizes invalid limit %s', value => {
    expect(trackingBufferLimit(value)).toBe(1048576);
  });
  it('floors and clamps finite explicit limits', () => {
    expect(trackingBufferLimit(0.2)).toBe(1); expect(trackingBufferLimit(12.8)).toBe(12); expect(trackingBufferLimit(1e50)).toBe(16777216);
  });
  it('accounts for UTF8 bytes and admits exactly at the boundary', () => {
    const good = socket({ bufferedAmount: 6 });
    expect(fanoutTrackingPayload([good], '🚚', 10)).toBe(1);
    const bad = socket({ bufferedAmount: 7 });
    expect(fanoutTrackingPayload([bad], '🚚', 10)).toBe(0); expect(bad.send).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -1])('retires invalid buffered amount %s', bufferedAmount => {
    const bad = socket({ bufferedAmount }); expect(fanoutTrackingPayload([bad], 'point')).toBe(0);
  });
  it('isolates synchronous callback failure and failed termination', () => {
    const bad = socket({ send: vi.fn((_p, callback) => callback(new Error('send'))), terminate: vi.fn(() => { throw new Error('terminate'); }) }), good = socket();
    expect(fanoutTrackingPayload([bad, good], 'point')).toBe(1); expect(good.send).toHaveBeenCalledOnce();
    expect(fanoutTrackingPayload([bad], 'point')).toBe(0); expect(bad.terminate).toHaveBeenCalledOnce();
  });
  it('retires asynchronous failure once without claiming peer receipt or retrying', () => {
    let callback; const bad = socket({ send: vi.fn((_p, cb) => { callback = cb; }) });
    expect(fanoutTrackingPayload([bad, bad], 'point')).toBe(1);
    callback(new Error('late')); callback(new Error('duplicate'));
    expect(fanoutTrackingPayload([bad], 'point')).toBe(0); expect(bad.send).toHaveBeenCalledOnce(); expect(bad.terminate).toHaveBeenCalledOnce();
  });
  it('does not accumulate an extra queue across sustained blocked-reader fanout', () => {
    const bad = socket({ bufferedAmount: 1048576 });
    for (let i = 0; i < 10000; i++) expect(fanoutTrackingPayload([bad], 'x'.repeat(1024))).toBe(0);
    expect(bad.send).not.toHaveBeenCalled(); expect(bad.terminate).toHaveBeenCalledOnce();
  });
  it('uses the configured finite cap for live tracker delivery', () => {
    vi.stubEnv('TRACKER_MAX_BUFFERED_BYTES', '1'); const bad = socket();
    tracker.__testing.setTrackingSubscriptions(new Map([['order', new Set([bad])]]));
    tracker.broadcastOrderEta('order', { minutes: 5 }); expect(bad.send).not.toHaveBeenCalled(); expect(bad.terminate).toHaveBeenCalledOnce();
  });
});

describe('native local WebSocket transport', () => {
  it('delivers the exact frame then retires a connection when its byte budget cannot admit a new frame', async () => {
    const server = http.createServer(); const wss = new WebSocketServer({ server }); let client;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const connected = once(wss, 'connection');
      client = new WebSocket(`ws://127.0.0.1:${server.address().port}`); await once(client, 'open');
      const [peer] = await connected; const message = once(client, 'message');
      expect(fanoutTrackingPayload([peer], 'native point')).toBe(1);
      expect((await message)[0].toString()).toBe('native point');
      const closed = once(client, 'close');
      expect(fanoutTrackingPayload([peer], 'too large', 1)).toBe(0); await closed;
      expect(peer.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      client?.terminate(); for (const peer of wss.clients) peer.terminate();
      await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
    }
  });
});


it('native paused reader reaches the queued-byte limit without an application retry queue', async () => {
  const server = http.createServer(); const wss = new WebSocketServer({ server }); let client;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const connected = once(wss, 'connection');
    client = new WebSocket(`ws://127.0.0.1:${server.address().port}`); await once(client, 'open');
    const [peer] = await connected; client._socket.pause();
    const originalTerminate = peer.terminate.bind(peer); let queuedAtRetirement;
    peer.terminate = () => { queuedAtRetirement = peer.bufferedAmount; originalTerminate(); };
    const payload = 'x'.repeat(32768); let accepted = 0;
    for (let i = 0; i < 1000 && queuedAtRetirement === undefined; i++) accepted += fanoutTrackingPayload([peer], payload, 65536);
    expect(accepted).toBeGreaterThan(0);
    expect(queuedAtRetirement).toBeGreaterThan(65536 - payload.length);
    // ws frame headers are transport overhead beyond the encoded payload budget.
    expect(queuedAtRetirement).toBeLessThanOrEqual(65536 + 14);
    expect(fanoutTrackingPayload([peer], payload, 65536)).toBe(0);
    const closed = once(client, 'close'); client._socket.resume(); await closed;
  } finally {
    client?.terminate(); for (const peer of wss.clients) peer.terminate();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
  }
});
