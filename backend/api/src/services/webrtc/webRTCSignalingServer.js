import logger from '../../middleware/logger.js';

export class WebRTCSignalingServer {
  /**
   * Normalizes incoming location coordinates from WebRTC telemetry.
   * @param {Object} location - Location object containing lat and lng
   * @returns {Object} Normalized location with numeric lat and lng
   */
  normalizeLocation(location) {
    // Fix: Guard against null or undefined input to prevent TypeError crashes
    if (!location) {
      throw new TypeError('Location object cannot be null or undefined');
    }

    if (typeof location.lat === 'undefined' || typeof location.lng === 'undefined') {
      throw new Error('Location object must contain lat and lng properties');
    }

    return {
      lat: Number(location.lat),
      lng: Number(location.lng),
      timestamp: location.timestamp ? Number(location.timestamp) : Date.now(),
    };
  }

  handleGPSData(socketId, payload) {
    try {
      if (!payload || !payload.location) {
        logger.warn({ socketId, payload }, '[webrtc-signaling] Received GPS payload without location data');
        return;
      }

      const normalized = this.normalizeLocation(payload.location);
      logger.info({ socketId, normalized }, '[webrtc-signaling] Successfully processed normalized GPS data');
    } catch (err) {
      logger.error({ err, socketId }, '[webrtc-signaling] Error handling GPS data telemetry');
    }
  }
}

export default WebRTCSignalingServer;
