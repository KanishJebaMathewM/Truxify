import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({}));

describe('WebRTCSignalingServer', () => {
  let WebRTCSignalingServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    WebRTCSignalingServer = (await import('../../src/services/webrtc/WebRTCSignalingServer.js')).default;
  });

  describe('createRoom', () => {
    it('creates a new room with a unique id', () => {
      const room1 = WebRTCSignalingServer.createRoom('driver-1');
      const room2 = WebRTCSignalingServer.createRoom('driver-2');
      expect(room1).not.toBe(room2);
    });

    it('returns existing room if room already exists', () => {
      const room1 = WebRTCSignalingServer.createRoom('order-1');
      const room2 = WebRTCSignalingServer.getRoom('order-1');
      expect(room1).toBe(room2);
    });
  });

  describe('joinRoom', () => {
    it('adds participant to room', () => {
      const room = WebRTCSignalingServer.createRoom('order-join');
      const mockWs = { id: 'ws-1', send: vi.fn() };
      const result = WebRTCSignalingServer.joinRoom('order-join', mockWs);
      expect(result).toBe(true);
    });

    it('returns false when room not found', () => {
      const mockWs = { id: 'ws-1', send: vi.fn() };
      const result = WebRTCSignalingServer.joinRoom('nonexistent-room', mockWs);
      expect(result).toBe(false);
    });
  });

  describe('leaveRoom', () => {
    it('removes participant from room', () => {
      const room = WebRTCSignalingServer.createRoom('order-leave');
      const mockWs = { id: 'ws-leave', send: vi.fn() };
      WebRTCSignalingServer.joinRoom('order-leave', mockWs);
      WebRTCSignalingServer.leaveRoom('order-leave', mockWs);
      const updatedRoom = WebRTCSignalingServer.getRoom('order-leave');
      expect(updatedRoom.participants.size).toBe(0);
    });
  });

  describe('routeSignalingMessage', () => {
    it('routes message to correct participant', () => {
      const mockSend = vi.fn();
      const sender = { id: 'ws-sender', send: vi.fn() };
      const receiver = { id: 'ws-receiver', send: mockSend };

      WebRTCSignalingServer.createRoom('order-signal');
      WebRTCSignalingServer.joinRoom('order-signal', sender);
      WebRTCSignalingServer.joinRoom('order-signal', receiver);

      const message = { type: 'offer', sdp: 'test-sdp' };
      WebRTCSignalingServer.routeSignalingMessage('order-signal', sender, message);

      expect(mockSend).toHaveBeenCalled();
    });
  });
});
