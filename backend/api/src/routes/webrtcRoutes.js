import express from 'express';
import { getWebRTCSignaling } from '../sockets/webrtc.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

function parseFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLatitude(value) {
  return value >= -90 && value <= 90;
}

function isLongitude(value) {
  return value >= -180 && value <= 180;
}

// Get WebRTC stats
router.get('/webrtc/stats', authenticate, userLimiter, requirePolicy('webrtc:view-stats'), (req, res) => {
  const signaling = getWebRTCSignaling();
  if (!signaling) {
    return res.status(503).json({
      success: false,
      error: 'WebRTC signaling server not initialized'
    });
  }
  res.json({
    success: true,
    data: signaling.getStats()
  });
});

// Get nearby peers
router.get('/webrtc/nearby', authenticate, userLimiter, requirePolicy('webrtc:view-nearby'), async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    const parsedLat = parseFiniteNumber(lat);
    const parsedLng = parseFiniteNumber(lng);
    const parsedRadius = radius === undefined ? 10 : parseFiniteNumber(radius);

    if (parsedLat === null || parsedLng === null) {
      return res.status(400).json({
        success: false,
        error: 'valid lat and lng required'
      });
    }

    if (!isLatitude(parsedLat) || !isLongitude(parsedLng)) {
      return res.status(400).json({
        success: false,
        error: 'lat or lng out of range'
      });
    }

    if (parsedRadius === null || parsedRadius <= 0) {
      return res.status(400).json({
        success: false,
        error: 'radius must be a positive number'
      });
    }

    const signaling = getWebRTCSignaling();
    if (!signaling) {
      return res.status(503).json({
        success: false,
        error: 'WebRTC signaling server not initialized'
      });
    }

    const peers = await signaling.getPeersNearLocation(
      parsedLat,
      parsedLng,
      parsedRadius
    );

    res.json({
      success: true,
      data: peers,
      count: peers.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get offline GPS data
router.get('/webrtc/offline/:peerId', authenticate, userLimiter, requirePolicy('webrtc:view-offline'), async (req, res) => {
  try {
    const { peerId } = req.params;
    const { since } = req.query;

    const signaling = getWebRTCSignaling();
    if (!signaling) {
      return res.status(503).json({
        success: false,
        error: 'WebRTC signaling server not initialized'
      });
    }

    const data = await signaling.getOfflineGPSData(peerId, since);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync offline data
router.post('/webrtc/sync/:peerId', authenticate, userLimiter, requirePolicy('webrtc:sync-offline'), async (req, res) => {
  try {
    const { peerId } = req.params;

    const signaling = getWebRTCSignaling();
    if (!signaling) {
      return res.status(503).json({
        success: false,
        error: 'WebRTC signaling server not initialized'
      });
    }

    await signaling.syncOfflineData(peerId);
    res.json({
      success: true,
      message: 'Offline data synced'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
