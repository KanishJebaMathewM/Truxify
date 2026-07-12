import express from 'express';
import { getWebRTCSignaling } from '../sockets/webrtc.js';

const router = express.Router();

// Get WebRTC stats
router.get('/webrtc/stats', (req, res) => {
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
router.get('/webrtc/nearby', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'lat and lng required'
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
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius) || 10
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
router.get('/webrtc/offline/:peerId', async (req, res) => {
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
router.post('/webrtc/sync/:peerId', async (req, res) => {
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