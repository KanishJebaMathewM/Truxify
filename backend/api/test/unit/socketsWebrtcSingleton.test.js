import { describe, it, expect, vi, beforeEach } from 'vitest';

const signalingMock = vi.hoisted(() => ({
  destroy: vi.fn(),
}));

vi.mock('../../src/services/webrtc/WebRTCSignalingServer.js', () => ({
  default: class {
    constructor(server) {
      this.server = server;
      Object.assign(this, signalingMock);
    }
  },
}));

const webrtc = await import('../../src/sockets/webrtc.js');

describe('sockets/webrtc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webrtc.closeWebRTCSignaling();
  });

  it('initWebRTCSignaling creates a signaling server once', () => {
    const server = { on: vi.fn(), removeListener: vi.fn() };
    const first = webrtc.initWebRTCSignaling(server);
    const second = webrtc.initWebRTCSignaling(server);

    expect(first).toBe(second);
    expect(webrtc.getWebRTCSignaling()).toBe(first);
  });

  it('getWebRTCSignaling returns null before init', () => {
    expect(webrtc.getWebRTCSignaling()).toBeNull();
  });

  it('getWebRTCSignaling returns the server after init', () => {
    webrtc.initWebRTCSignaling({ on: vi.fn(), removeListener: vi.fn() });
    expect(webrtc.getWebRTCSignaling()).not.toBeNull();
  });

  it('closeWebRTCSignaling destroys the server and resets the singleton', () => {
    webrtc.initWebRTCSignaling({ on: vi.fn(), removeListener: vi.fn() });
    webrtc.closeWebRTCSignaling();

    expect(signalingMock.destroy).toHaveBeenCalled();
    expect(webrtc.getWebRTCSignaling()).toBeNull();
  });
});
