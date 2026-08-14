import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signalingMock } = vi.hoisted(() => ({
  signalingMock: { on: vi.fn(), destroy: vi.fn() },
}));

vi.mock('../../../src/services/webrtc/WebRTCSignalingServer.js', () => ({
  default: class { constructor() { Object.assign(this, signalingMock); } },
}));

const { initWebRTCSignaling, getWebRTCSignaling, closeWebRTCSignaling } = await import('../../../src/sockets/webrtc.js');

describe('webrtc socket module', () => {
  beforeEach(() => {
    closeWebRTCSignaling();
    vi.clearAllMocks();
  });

  it('returns null before initialization', () => {
    expect(getWebRTCSignaling()).toBeNull();
  });

  it('initializes the signaling server once', () => {
    const server = {};
    const first = initWebRTCSignaling(server);
    const second = initWebRTCSignaling(server);
    expect(first).toBe(second);
  });

  it('closeWebRTCSignaling clears the singleton', () => {
    const server = { on: vi.fn() };
    initWebRTCSignaling(server);
    closeWebRTCSignaling();
    expect(getWebRTCSignaling()).toBeNull();
  });

  it('closeWebRTCSignaling is idempotent', () => {
    closeWebRTCSignaling();
    closeWebRTCSignaling();
    expect(getWebRTCSignaling()).toBeNull();
  });
});
