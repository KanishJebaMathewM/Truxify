import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../../src/middleware/auth.js', () => ({ verifyAuthToken: mocks.verify }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({ supabase: null, redisClient: null, createUserClient: vi.fn() }));
import Server from '../../src/services/webrtc/WebRTCSignalingServer.js';

function fixture() {
  const server = Object.create(Server.prototype);
  server.peers = new Map();
  server.meshes = new Map();
  server.maxMeshes = 2;
  let connect;
  server.wss = { on: (_event, handler) => { connect = handler; } };
  server.setupWebSocket();
  const ws = { close: vi.fn(), send: vi.fn(), on: vi.fn(), readyState: 1 };
  const req = { url: '/webrtc', headers: { host: 'localhost', authorization: 'Bearer valid' } };
  return { server, ws, req, connect };
}

describe('authenticated WebRTC connection mesh selection', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue({ id: 'user-1', role: 'driver' });
  });

  it('registers a valid connection in a server-generated mesh', async () => {
    const { server, ws, req, connect } = fixture();
    await connect(ws, req);
    expect(server.peers.size).toBe(1);
    const [peerId, peer] = [...server.peers][0];
    expect(peer.userId).toBe('user-1');
    expect(server.meshes.get(peer.meshId).has(peerId)).toBe(true);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('peer-id'));
    expect(ws.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('reuses an active mesh for the same authenticated user at capacity', async () => {
    const { server, ws, req, connect } = fixture();
    server.maxMeshes = 1;
    server.meshes.set('existing', new Set(['old']));
    server.peers.set('old', { userId: 'user-1', meshId: 'existing', ws: { readyState: 0 } });
    await connect(ws, req);
    expect(server.meshes.size).toBe(1);
    expect(server.meshes.get('existing').size).toBe(2);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('ignores arbitrary URL mesh IDs belonging to another user', async () => {
    const { server, ws, req, connect } = fixture();
    server.meshes.set('foreign', new Set(['old']));
    server.peers.set('old', { userId: 'other', meshId: 'foreign', ws: { readyState: 0 } });
    req.url = '/webrtc?meshId=foreign';
    await connect(ws, req);
    const peer = [...server.peers.values()].find((p) => p.userId === 'user-1');
    expect(peer.meshId).not.toBe('foreign');
    expect(server.meshes.get('foreign').size).toBe(1);
  });

  it('rejects a new mesh at capacity without registering the peer', async () => {
    const { server, ws, req, connect } = fixture();
    server.maxMeshes = 1;
    server.meshes.set('foreign', new Set());
    await connect(ws, req);
    expect(ws.close).toHaveBeenCalledWith(4002, 'Maximum mesh limit reached');
    expect(server.peers.size).toBe(0);
  });

  it('ignores stale same-user meshes and allocates a live mesh', async () => {
    const { server, ws, req, connect } = fixture();
    server.peers.set('old', { userId: 'user-1', meshId: 'stale', ws: { readyState: 0 } });
    await connect(ws, req);
    const peer = [...server.peers.values()].find((p) => p.ws === ws);
    expect(peer.meshId).not.toBe('stale');
    expect(server.meshes.has(peer.meshId)).toBe(true);
  });

  it.each(['missing', 'invalid', 'query'])('rejects %s authentication before allocating mesh state', async (kind) => {
    const { server, ws, req, connect } = fixture();
    if (kind === 'missing') delete req.headers.authorization;
    if (kind === 'invalid') mocks.verify.mockRejectedValueOnce(new Error('bad token'));
    if (kind === 'query') req.url = '/webrtc?token=secret';
    await connect(ws, req);
    expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect(server.peers.size).toBe(0);
    expect(server.meshes.size).toBe(0);
  });
});
