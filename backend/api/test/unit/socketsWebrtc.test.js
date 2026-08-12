import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signalingMock } = vi.hoisted(() => ({
  signalingMock: { destroy: vi.fn() },
}));

vi.mock('../../src/services/webrtc/WebRTCSignalingServer.js', () => ({
  default: class { constructor() { Object.assign(this, signalingMock); } },
}));

import {
  initWebRTCSignaling,
  getWebRTCSignaling,
  closeWebRTCSignaling,
} from '../../src/sockets/webrtc.js';

describe('sockets/webrtc', () => {
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
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('returns the initialized server', () => {
    const server = {};
    const s = initWebRTCSignaling(server);
    expect(getWebRTCSignaling()).toBe(s);
  });

  it('closes and clears the signaling server', () => {
    initWebRTCSignaling({});
    closeWebRTCSignaling();
    expect(signalingMock.destroy).toHaveBeenCalled();
    expect(getWebRTCSignaling()).toBeNull();
  });
});
