import express from 'express';
import { getWebRTCSignaling } from '../sockets/webrtc.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter, nearbyLimiter } from '../middleware/rateLimiter.js';

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
router.get('/webrtc/nearby', authenticate, userLimiter, nearbyLimiter, requirePolicy('webrtc:view-nearby'), async (req, res) => {
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
      parsedRadius,
      req.user
    );

    res.json({
      success: true,
      data: peers,
      count: peers.length
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message
    });
  }
});

// Get offline GPS data
/**
 * @openapi
 * components:
 *   schemas:
 *     WebRTCOfflineGPSRecord:
 *       type: object
 *       required:
 *         - id
 *         - data
 *         - timestamp
 *         - synced
 *       properties:
 *         id:
 *           type: string
 *           description: Offline GPS row identifier
 *         data:
 *           type: object
 *           additionalProperties: true
 *           description: Stored GPS payload
 *         timestamp:
 *           type: integer
 *           format: int64
 *           description: Unix timestamp in milliseconds
 *         synced:
 *           type: boolean
 *           description: Whether the row has already been synchronized
 *     WebRTCOfflineGPSResponse:
 *       type: object
 *       required:
 *         - success
 *         - data
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/WebRTCOfflineGPSRecord'
 */

/**
 * @openapi
 * /webrtc/offline/{peerId}:
 *   get:
 *     tags: [WebRTC]
 *     summary: Retrieve offline GPS data for a peer
 *     description: Returns bounded offline GPS rows newer than the requested timestamp after verifying that the authenticated user may access the peer.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: peerId
 *         required: true
 *         description: WebRTC peer identifier
 *         schema:
 *           type: string
 *       - in: query
 *         name: since
 *         required: true
 *         description: Unix timestamp in milliseconds. Only rows newer than this timestamp are returned.
 *         schema:
 *           type: integer
 *           format: int64
 *           minimum: 0
 *     responses:
 *       200:
 *         description: Offline GPS data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebRTCOfflineGPSResponse'
 *       400:
 *         description: since is missing, invalid, or negative
 *       403:
 *         description: The authenticated user cannot access the requested peer
 *       500:
 *         description: Offline GPS retrieval failed
 *       503:
 *         description: WebRTC signaling server is not initialized
 */
router.get('/webrtc/offline/:peerId', authenticate, userLimiter, requirePolicy('webrtc:view-offline'), async (req, res) => {
  try {
    const { peerId } = req.params;

    const signaling = getWebRTCSignaling();
    if (!signaling) {
      return res.status(503).json({
        success: false,
        error: 'WebRTC signaling server not initialized'
      });
    }

    if (!signaling.canUserAccessPeer(peerId, req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied for requested peer'
      });
    }

    const parsedSince = parseFiniteNumber(req.query.since);
    if (parsedSince === null || parsedSince < 0) {
      return res.status(400).json({
        success: false,
        error: 'since is required and must be a non-negative timestamp'
      });
    }

    const data = await signaling.getOfflineGPSData(peerId, parsedSince, req.user);
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

    if (!signaling.canUserAccessPeer(peerId, req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied for requested peer'
      });
    }

    const ackedIds = req.body?.ackedIds;
    if (!Array.isArray(ackedIds) || ackedIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ackedIds is required and must be a non-empty array of row ids the client received'
      });
    }

    await signaling.syncOfflineData(peerId, ackedIds, req.user);
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
