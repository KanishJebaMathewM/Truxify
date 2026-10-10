import { describe, it, expect } from 'vitest';
import { WebRTCSignalingServer } from '../../src/services/webrtc/WebRTCSignalingServer.js';

describe('WebRTCSignalingServer - Location Normalization and Validation', () => {
  describe('normalizeLocation', () => {
    it('should convert string lat/lng coordinates to numbers', () => {
      const input = { lat: '13.0827', lng: '80.2707', accuracy: 5 };
      const result = WebRTCSignalingServer.normalizeLocation(input);

      expect(result.lat).toBe(13.0827);
      expect(typeof result.lat).toBe('number');
      expect(result.lng).toBe(80.2707);
      expect(typeof result.lng).toBe('number');
    });

    it('should preserve other location properties during normalization', () => {
      const input = { lat: 13.0827, lng: 80.2707, timestamp: 123456789, device: 'mobile' };
      const result = WebRTCSignalingServer.normalizeLocation(input);

      expect(result).toEqual(input);
      expect(result.timestamp).toBe(123456789);
      expect(result.device).toBe('mobile');
    });
  });

  describe('isValidLocation', () => {
    it('should return true for valid lat/lng coordinates', () => {
      const validLocation = { lat: 13.0827, lng: 80.2707 };
      expect(WebRTCSignalingServer.isValidLocation(validLocation)).toBe(true);
    });

    it('should return false for non-finite or non-numeric values', () => {
      expect(WebRTCSignalingServer.isValidLocation({ lat: NaN, lng: 80.2707 })).toBe(false);
      expect(WebRTCSignalingServer.isValidLocation({ lat: 13.0827, lng: Infinity })).toBe(false);
      expect(WebRTCSignalingServer.isValidLocation({ lat: 'abc', lng: 80.2707 })).toBe(false);
      expect(WebRTCSignalingServer.isValidLocation(null)).toBe(false);
    });

    it('should reject out-of-range latitudes and longitudes', () => {
      // Latitude must be between -90 and 90
      expect(WebRTCSignalingServer.isValidLocation({ lat: 95.0, lng: 80.2707 })).toBe(false);
      expect(WebRTCSignalingServer.isValidLocation({ lat: -95.0, lng: 80.2707 })).toBe(false);

      // Longitude must be between -180 and 180
      expect(WebRTCSignalingServer.isValidLocation({ lat: 13.0827, lng: 190.0 })).toBe(false);
      expect(WebRTCSignalingServer.isValidLocation({ lat: 13.0827, lng: -190.0 })).toBe(false);
    });
  });
});
