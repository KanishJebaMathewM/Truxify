import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The signalling server is a peer *mesh*, not a room server: peers are keyed
 * by a generated peerId and grouped into meshes. Constructing it binds a
 * WebSocketServer to an http server and starts a 30s discovery interval, so
 * these tests build a bare instance off the prototype and populate the two
 * Maps directly. That keeps the pure logic — location validation, distance,
 * peer fan-out, authorization — testable without any sockets or timers.
 */

const supabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [] }),
};

const supabaseMock = { from: vi.fn(() => supabaseQuery) };
const redisMock = { setex: vi.fn().mockResolvedValue('OK') };

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock,
  redisClient: redisMock,
  firebaseAdmin: null,
  mongoDb: null,
}));

vi.mock('ws', () => ({
  WebSocketServer: class {
    on() {}
    close() {}
  },
}));

const { default: WebRTCSignalingServer } = await import(
  '../../src/services/webrtc/WebRTCSignalingServer.js'
);

const OPEN = 1;

/** A signalling server with no sockets, no timers and no discovery loop. */
function bareServer() {
  const server = Object.create(WebRTCSignalingServer.prototype);
  server.peers = new Map();
  server.meshes = new Map();
  server.redis = redisMock;
  server.wss = { close: vi.fn() };
  return server;
}

/** Registers a peer in `meshId`, creating the mesh if needed. */
function addPeer(server, peerId, { meshId = 'mesh-1', readyState = OPEN, ...rest } = {}) {
  const ws = { readyState, send: vi.fn(), close: vi.fn() };
  server.peers.set(peerId, { ws, meshId, connectedAt: 1700000000000, ...rest });
  if (!server.meshes.has(meshId)) server.meshes.set(meshId, new Set());
  server.meshes.get(meshId).add(peerId);
  return ws;
}

describe('WebRTCSignalingServer', () => {
  let server;

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseQuery.insert.mockResolvedValue({ error: null });
    supabaseQuery.order.mockResolvedValue({ data: [] });
    server = bareServer();
  });

  describe('isValidLocation()', () => {
    it('accepts a well-formed coordinate pair', () => {
      expect(server.isValidLocation({ lat: 12.97, lng: 77.59 })).toBe(true);
    });

    it('accepts numeric strings, since payloads arrive as JSON from clients', () => {
      expect(server.isValidLocation({ lat: '12.97', lng: '77.59' })).toBe(true);
    });

    it.each([
      ['lat above 90', { lat: 90.1, lng: 0 }],
      ['lat below -90', { lat: -90.1, lng: 0 }],
      ['lng above 180', { lat: 0, lng: 180.1 }],
      ['lng below -180', { lat: 0, lng: -180.1 }],
    ])('rejects %s', (_label, location) => {
      expect(server.isValidLocation(location)).toBe(false);
    });

    it.each([
      ['the poles and the antimeridian', { lat: 90, lng: 180 }],
      ['their negative extremes', { lat: -90, lng: -180 }],
      ['null island', { lat: 0, lng: 0 }],
    ])('accepts %s as in range', (_label, location) => {
      expect(server.isValidLocation(location)).toBe(true);
    });

    it.each([
      ['NaN lat', { lat: NaN, lng: 0 }],
      ['a non-numeric string', { lat: 'north', lng: '0' }],
      ['Infinity', { lat: Infinity, lng: 0 }],
      ['a missing lng', { lat: 12.97 }],
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s', (_label, location) => {
      expect(server.isValidLocation(location)).toBe(false);
    });

    it('rejects an empty object rather than coercing it to 0,0', () => {
      // Number(undefined) is NaN, not 0 — the Number.isFinite guard is what
      // stops a payload with no coordinates being read as null island.
      expect(server.isValidLocation({})).toBe(false);
    });
  });

  describe('normalizeLocation()', () => {
    it('coerces string coordinates to numbers', () => {
      expect(server.normalizeLocation({ lat: '12.97', lng: '77.59' })).toEqual({
        lat: 12.97,
        lng: 77.59,
      });
    });

    it('preserves the other fields on the location', () => {
      const normalized = server.normalizeLocation({
        lat: '1',
        lng: '2',
        accuracy: 5,
        heading: 90,
      });

      expect(normalized).toMatchObject({ accuracy: 5, heading: 90 });
    });

    it('does not mutate its argument', () => {
      const location = { lat: '12.97', lng: '77.59' };
      server.normalizeLocation(location);
      expect(location.lat).toBe('12.97');
    });
  });

  describe('calculateDistance()', () => {
    it('returns 0 for identical points', () => {
      expect(server.calculateDistance(12.97, 77.59, 12.97, 77.59)).toBe(0);
    });

    it('measures a known separation in kilometres', () => {
      // Bengaluru -> Chennai, roughly 290km great-circle.
      const km = server.calculateDistance(12.9716, 77.5946, 13.0827, 80.2707);
      expect(km).toBeGreaterThan(280);
      expect(km).toBeLessThan(300);
    });

    it('is symmetric', () => {
      const forward = server.calculateDistance(12.97, 77.59, 13.08, 80.27);
      const back = server.calculateDistance(13.08, 80.27, 12.97, 77.59);
      expect(forward).toBeCloseTo(back, 9);
    });

    it('handles antipodal points without NaN from floating-point drift', () => {
      // atan2(sqrt(a), sqrt(1-a)) with a marginally above 1 is the classic
      // haversine NaN; half the Earth's circumference is ~20015km.
      const km = server.calculateDistance(0, 0, 0, 180);
      expect(Number.isFinite(km)).toBe(true);
      expect(km).toBeCloseTo(20015, 0);
    });
  });

  describe('generatePeerId() / getOrCreateMesh()', () => {
    it('generates unique, prefixed peer ids', () => {
      const ids = new Set(Array.from({ length: 50 }, () => server.generatePeerId()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id.startsWith('peer_')).toBe(true);
    });

    it('registers each new mesh as an empty set', () => {
      const meshId = server.getOrCreateMesh();
      expect(meshId.startsWith('mesh_')).toBe(true);
      expect(server.meshes.get(meshId)).toEqual(new Set());
    });

    it('creates a distinct mesh on every call', () => {
      expect(server.getOrCreateMesh()).not.toBe(server.getOrCreateMesh());
      expect(server.meshes.size).toBe(2);
    });
  });

  describe('sendToPeer()', () => {
    it('serializes the message to the peer socket', () => {
      const ws = addPeer(server, 'peer-1');

      server.sendToPeer('peer-1', { type: 'offer', sdp: 'x' });

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'offer', sdp: 'x' }));
    });

    it('is a no-op for an unknown peer', () => {
      expect(() => server.sendToPeer('nobody', { type: 'offer' })).not.toThrow();
    });

    it('does not write to a socket that is not open', () => {
      const ws = addPeer(server, 'peer-1', { readyState: 3 /* CLOSED */ });

      server.sendToPeer('peer-1', { type: 'offer' });

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('sendPeerList()', () => {
    it('lists the other peers in the same mesh and excludes the recipient', () => {
      const ws = addPeer(server, 'peer-1', { location: { lat: 1, lng: 1 } });
      addPeer(server, 'peer-2', { location: { lat: 2, lng: 2 } });

      server.sendPeerList('peer-1');

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('peer-list');
      expect(payload.count).toBe(1);
      expect(payload.peers.map((p) => p.peerId)).toEqual(['peer-2']);
    });

    it('does not leak peers from another mesh', () => {
      const ws = addPeer(server, 'peer-1', { meshId: 'mesh-a' });
      addPeer(server, 'peer-2', { meshId: 'mesh-b' });

      server.sendPeerList('peer-1');

      expect(JSON.parse(ws.send.mock.calls[0][0]).peers).toEqual([]);
    });

    it('sends an empty list rather than nothing when alone in a mesh', () => {
      const ws = addPeer(server, 'peer-1');

      server.sendPeerList('peer-1');

      expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ count: 0, peers: [] });
    });

    it('is a no-op for an unknown peer', () => {
      expect(() => server.sendPeerList('nobody')).not.toThrow();
    });

    it('skips mesh members whose peer record has already been removed', () => {
      const ws = addPeer(server, 'peer-1');
      server.meshes.get('mesh-1').add('ghost-peer');

      server.sendPeerList('peer-1');

      expect(JSON.parse(ws.send.mock.calls[0][0]).count).toBe(0);
    });
  });

  describe('handleDisconnect()', () => {
    it('removes the peer from both the peer map and its mesh', async () => {
      addPeer(server, 'peer-1');
      addPeer(server, 'peer-2');

      await server.handleDisconnect('peer-1');

      expect(server.peers.has('peer-1')).toBe(false);
      expect(server.meshes.get('mesh-1')).toEqual(new Set(['peer-2']));
    });

    it('drops the mesh once its last peer leaves, so meshes do not accumulate', async () => {
      addPeer(server, 'peer-1');

      await server.handleDisconnect('peer-1');

      expect(server.meshes.has('mesh-1')).toBe(false);
    });

    it('is a no-op for an unknown peer', async () => {
      await expect(server.handleDisconnect('nobody')).resolves.toBeUndefined();
    });
  });

  describe('getPeersNearLocation()', () => {
    beforeEach(() => {
      addPeer(server, 'near', { location: { lat: 12.9716, lng: 77.5946 } });
      addPeer(server, 'far', { location: { lat: 13.0827, lng: 80.2707 } });
      addPeer(server, 'no-location');
    });

    it('returns only peers inside the radius, with their distance', async () => {
      const found = await server.getPeersNearLocation(12.9716, 77.5946, 10);

      expect(found).toHaveLength(1);
      expect(found[0].peerId).toBe('near');
      expect(found[0].distance).toBeCloseTo(0, 6);
    });

    it('widens with the radius', async () => {
      const found = await server.getPeersNearLocation(12.9716, 77.5946, 500);
      expect(found.map((p) => p.peerId).sort()).toEqual(['far', 'near']);
    });

    it('defaults to a 10km radius', async () => {
      const found = await server.getPeersNearLocation(12.9716, 77.5946);
      expect(found.map((p) => p.peerId)).toEqual(['near']);
    });

    it('skips peers that have not reported a location', async () => {
      const found = await server.getPeersNearLocation(12.9716, 77.5946, 100000);
      expect(found.map((p) => p.peerId)).not.toContain('no-location');
    });
  });

  describe('getStats()', () => {
    it('reports zeroes on an idle server', () => {
      expect(server.getStats()).toEqual({
        totalPeers: 0,
        totalMeshes: 0,
        peersPerMesh: [],
      });
    });

    it('counts peers per mesh', () => {
      addPeer(server, 'peer-1', { meshId: 'mesh-a' });
      addPeer(server, 'peer-2', { meshId: 'mesh-a' });
      addPeer(server, 'peer-3', { meshId: 'mesh-b' });

      expect(server.getStats()).toEqual({
        totalPeers: 3,
        totalMeshes: 2,
        peersPerMesh: [
          { meshId: 'mesh-a', peerCount: 2 },
          { meshId: 'mesh-b', peerCount: 1 },
        ],
      });
    });
  });

  describe('canUserAccessPeer()', () => {
    beforeEach(() => {
      addPeer(server, 'peer-1', { userId: 'user-1' });
    });

    it('lets a user reach their own peer', () => {
      expect(server.canUserAccessPeer('peer-1', { id: 'user-1' })).toBe(true);
    });

    it('refuses another user', () => {
      expect(server.canUserAccessPeer('peer-1', { id: 'user-2' })).toBe(false);
    });

    it('lets an admin reach any peer', () => {
      expect(server.canUserAccessPeer('peer-1', { id: 'someone', role: 'admin' })).toBe(true);
    });

    it('lets an admin through even for a peer that does not exist', () => {
      expect(server.canUserAccessPeer('nobody', { role: 'admin' })).toBe(true);
    });

    it('refuses a non-admin for an unknown peer', () => {
      expect(server.canUserAccessPeer('nobody', { id: 'user-1' })).toBe(false);
    });

    it.each([
      ['no user', undefined],
      ['null', null],
      ['a user with no id', {}],
    ])(
      'currently ADMITS %s to a peer with an unset userId (undefined === undefined)',
      (_label, user) => {
        // Not the intended behaviour — pinned so the fix is visible as a diff.
        // `peer.userId === user?.id` is true when both sides are undefined, so
        // a peer registered from a token with no `id` claim is reachable by a
        // caller who also has no id. Tracked separately; see the follow-up
        // that tightens this to require both ids to be present.
        addPeer(server, 'peer-anon', { userId: undefined });
        expect(server.canUserAccessPeer('peer-anon', user)).toBe(true);
      },
    );

    it('refuses an identified user for a peer with an unset userId', () => {
      addPeer(server, 'peer-anon', { userId: undefined });
      expect(server.canUserAccessPeer('peer-anon', { id: 'user-1' })).toBe(false);
    });
  });

  describe('getOfflineGPSData() authorization', () => {
    beforeEach(() => {
      addPeer(server, 'peer-1', { userId: 'user-1' });
    });

    it('returns [] and never queries for an unauthorized user', async () => {
      const result = await server.getOfflineGPSData('peer-1', 0, { id: 'user-2' });

      expect(result).toEqual([]);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('returns [] and never queries when no user is supplied', async () => {
      const result = await server.getOfflineGPSData('peer-1', 0, null);

      expect(result).toEqual([]);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('queries the owning user\'s data', async () => {
      supabaseQuery.order.mockResolvedValue({ data: [{ peerId: 'peer-1' }] });

      const result = await server.getOfflineGPSData('peer-1', 100, { id: 'user-1' });

      expect(supabaseMock.from).toHaveBeenCalledWith('gps_offline_data');
      expect(supabaseQuery.eq).toHaveBeenCalledWith('peerId', 'peer-1');
      expect(supabaseQuery.gt).toHaveBeenCalledWith('timestamp', 100);
      expect(result).toEqual([{ peerId: 'peer-1' }]);
    });

    it('falls back to timestamp 0 when no cursor is given', async () => {
      await server.getOfflineGPSData('peer-1', undefined, { id: 'user-1' });
      expect(supabaseQuery.gt).toHaveBeenCalledWith('timestamp', 0);
    });

    it('returns [] rather than null when the query yields nothing', async () => {
      supabaseQuery.order.mockResolvedValue({ data: null });
      await expect(
        server.getOfflineGPSData('peer-1', 0, { id: 'user-1' }),
      ).resolves.toEqual([]);
    });
  });

  describe('syncOfflineData() authorization', () => {
    beforeEach(() => {
      addPeer(server, 'peer-1', { userId: 'user-1' });
    });

    it('does not write for an unauthorized user', async () => {
      await server.syncOfflineData('peer-1', { id: 'user-2' });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('marks only the unsynced rows of the owning peer', async () => {
      supabaseQuery.eq.mockReturnValue(supabaseQuery);

      await server.syncOfflineData('peer-1', { id: 'user-1' });

      expect(supabaseQuery.update).toHaveBeenCalledWith({ synced: true });
      expect(supabaseQuery.eq).toHaveBeenCalledWith('peerId', 'peer-1');
      expect(supabaseQuery.eq).toHaveBeenCalledWith('synced', false);
    });
  });

  describe('destroy()', () => {
    it('closes every peer socket and clears the maps', () => {
      const ws1 = addPeer(server, 'peer-1');
      const ws2 = addPeer(server, 'peer-2', { meshId: 'mesh-b' });

      server.destroy();

      expect(ws1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(ws2.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(server.peers.size).toBe(0);
      expect(server.meshes.size).toBe(0);
      expect(server.wss.close).toHaveBeenCalled();
    });

    it('keeps closing the remaining peers when one socket throws', () => {
      const ws1 = addPeer(server, 'peer-1');
      ws1.close.mockImplementation(() => {
        throw new Error('already closed');
      });
      const ws2 = addPeer(server, 'peer-2');

      expect(() => server.destroy()).not.toThrow();
      expect(ws2.close).toHaveBeenCalled();
    });
  });
});
