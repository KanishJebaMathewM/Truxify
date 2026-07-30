import { beforeEach, describe, expect, it, vi } from 'vitest';

const destroyMock = vi.fn();
const closeMock = vi.fn();

vi.mock('../../src/services/webrtc/WebRTCSignalingServer.js', () => ({
  default: vi.fn().mockImplementation(function WebRTCSignalingServerMock() {
    this.destroy = destroyMock;
    this.wss = {
      close: closeMock,
    };
  }),
}));

const { closeWebRTCSignaling, initWebRTCSignaling } = await import('../../src/sockets/webrtc.js');

describe('WebRTC signaling socket lifecycle', () => {
  beforeEach(() => {
    destroyMock.mockClear();
    closeMock.mockClear();
    closeWebRTCSignaling();
    destroyMock.mockClear();
  });

  it('uses full signaling teardown when closing the singleton', () => {
    initWebRTCSignaling({});
    closeWebRTCSignaling();

    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });
});
