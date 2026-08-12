import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { default: WebRTCSignalingServer } = await import('../../src/services/webrtc/WebRTCSignalingServer.js');

function makeServer() {
  const server = Object.create(WebRTCSignalingServer.prototype);
  server.redis = null;
  server.peers = new Map([
    ['peer-1', {
      location: null,
      meshId: 'mesh-1',
      ws: { readyState: 1 },
    }],
  ]);
  server.meshes = new Map([['mesh-1', new Set(['peer-1'])]]);
  server.relayLocation = vi.fn();
  return server;
}

describe('WebRTCSignalingServer location-update', () => {
  it('drops invalid location updates without relaying them', async () => {
    const server = makeServer();

    await server.handleMessage('peer-1', {
      type: 'location-update',
      location: { lat: 120, lng: 75 },
    });

    expect(server.peers.get('peer-1').location).toBeNull();
    expect(server.relayLocation).not.toHaveBeenCalled();
  });

  it('normalizes valid location updates before storing and relaying them', async () => {
    const server = makeServer();

    await server.handleMessage('peer-1', {
      type: 'location-update',
      location: { lat: '21.17', lng: '72.83' },
    });

    expect(server.peers.get('peer-1').location).toEqual({ lat: 21.17, lng: 72.83 });
    expect(server.relayLocation).toHaveBeenCalledWith('peer-1', { lat: 21.17, lng: 72.83 });
  });
});
