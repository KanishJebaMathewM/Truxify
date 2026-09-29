import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import { verifyAuthToken } from '../../middleware/auth.js';
import logger from '../../middleware/logger.js';
import { supabase, redisClient, createUserClient } from '../../config/db.js';

const OFFLINE_GPS_PAGE_SIZE = 1000;

class WebRTCSignalingServer {
  constructor(server) {
    const MAX_WS_PAYLOAD_BYTES = parseInt(process.env.WS_MAX_PAYLOAD_BYTES, 10);
    this.wss = new WebSocketServer({ server, path: '/webrtc', maxPayload: Number.isFinite(MAX_WS_PAYLOAD_BYTES) ? MAX_WS_PAYLOAD_BYTES : 4096 });
    const parsedMaxMeshes = parseInt(process.env.WS_MAX_MESHES, 10);
    this.maxMeshes = Number.isFinite(parsedMaxMeshes) && parsedMaxMeshes > 0 ? parsedMaxMeshes : 10000;
    const parsedRelayRadius = parseFloat(process.env.WEBRTC_LOCATION_RELAY_RADIUS_KM);
    this.locationRelayRadius = Number.isFinite(parsedRelayRadius) && parsedRelayRadius > 0 ? parsedRelayRadius : 50;
    const parsedMaxRadius = parseFloat(process.env.WEBRTC_MAX_RELAY_RADIUS_KM);
    this.maxRelayRadius = Number.isFinite(parsedMaxRadius) && parsedMaxRadius > 0 ? parsedMaxRadius : 200;
    const parsedRateLimit = parseInt(process.env.WEBRTC_LOCATION_RATE_LIMIT_MS, 10);
    this.locationRateLimitMs = Number.isFinite(parsedRateLimit) && parsedRateLimit > 0 ? parsedRateLimit : 1000;
    this.redis = redisClient;
    this.peers = new Map(); // peerId -> { ws, location, meshId }
    this.meshes = new Map(); // meshId -> Set of peerIds
    
    this.setupWebSocket();
    this.startDiscovery();
    
    logger.info('WebRTC Signaling Server initialized');
  }

  async isUserAuthorizedForMesh(userId, meshId, userRole) {
    if (!userId || !meshId) return false;
    if (userRole === 'admin') return true;

    for (const peer of this.peers.values()) {
      if (peer.meshId === meshId && peer.userId === userId) {
        return true;
      }
    }

    if (supabase && typeof supabase.from === 'function') {
      try {
        const { data: trip } = await supabase
          .from('trips')
          .select('id')
          .eq('id', meshId)
          .or(`driver_id.eq.${userId},customer_id.eq.${userId}`)
          .maybeSingle();

        if (trip) return true;

        const { data: order } = await supabase
          .from('orders')
          .select('id')
          .eq('id', meshId)
          .or(`driver_id.eq.${userId},customer_id.eq.${userId}`)
          .maybeSingle();

        if (order) return true;

        const { data: convoy } = await supabase
          .from('convoys')
          .select('id')
          .eq('id', meshId)
          .or(`lead_driver_id.eq.${userId},driver_id.eq.${userId}`)
          .maybeSingle();

        if (convoy) return true;
      } catch (err) {
        logger.warn({ err: err.message, userId, meshId }, '[WebRTC] Error verifying mesh authorization');
      }
    }

    return false;
  }

  capPrecision(location, decimals = 2) {
    if (!location) return null;
    const factor = Math.pow(10, decimals);
    return {
      ...location,
      lat: Math.round(Number(location.lat) * factor) / factor,
      lng: Math.round(Number(location.lng) * factor) / factor,
      precision: 'coarse'
    };
  }

  setupWebSocket() {
    this.wss.on('connection', async (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // Reject tokens in the URL query string — they leak via logs, proxies,
      // and browser history. Only the Authorization header is accepted.
      if (url.searchParams.get('token')) {
        logger.warn('WebRTC connection rejected: token provided in query string');
        ws.close(4001, 'Token in URL is not allowed');
        return;
      }

      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        logger.warn('WebRTC connection rejected: no token provided');
        ws.close(4001, 'Authentication required');
        return;
      }

      let decoded;
      try {
        decoded = await verifyAuthToken(token);
      } catch (err) {
        logger.warn(`WebRTC connection rejected: ${err.message}`);
        ws.close(4001, 'Invalid token');
        return;
      }

      const peerId = this.generatePeerId();

      if (!meshId) {
        for (const [existingPeerId, peer] of this.peers.entries()) {
          if (peer.userId === decoded.id && peer.meshId && this.meshes.has(peer.meshId)) {
            meshId = peer.meshId;
            break;
          }
        }
      }

      const limit = this.maxMeshes || 10000;
      if (!meshId) {
        if (this.meshes.size >= limit) {
          logger.warn('WebRTC connection rejected: maximum mesh limit reached');
          ws.close(4002, 'Maximum mesh limit reached');
          return;
        }
        meshId = this.getOrCreateMesh();
        if (!meshId) {
          logger.warn('WebRTC connection rejected: maximum mesh limit reached');
          ws.close(4002, 'Maximum mesh limit reached');
          return;
        }
      }

      // Store peer with authenticated user info
      this.peers.set(peerId, {
        ws,
        userId: decoded.id,
        role: decoded.role,
        token,
        location: null,
        meshId,
        connectedAt: Date.now(),
        lastPing: Date.now(),
        lastLocationRelay: 0
      });

      // Add to mesh
      if (!this.meshes.has(meshId)) {
        this.meshes.set(meshId, new Set());
      }
      this.meshes.get(meshId).add(peerId);

      logger.info(`🔗 Peer ${peerId} connected to mesh ${meshId}`);

      // Send peer ID to client
      this.sendToPeer(peerId, {
        type: 'peer-id',
        peerId,
        meshId
      });

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await this.handleMessage(peerId, message);
        } catch (error) {
          logger.error('WebRTC message error:', error);
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.handleDisconnect(peerId);
      });

      // Handle errors to prevent process crash
      ws.on('error', (err) => {
        logger.warn({ peerId, err: err.message }, 'WebSocket error for peer');
      });

      // Send connected peers list
      this.sendPeerList(peerId);
    });
  }

  async handleMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    switch (message.type) {
      case 'location-update':
        if (!this.isValidLocation(message.location)) {
          logger.warn(`Invalid WebRTC location update dropped for peer ${peerId}`);
          return;
        }

        peer.location = this.normalizeLocation(message.location);
        if (this.redis) {
          await this.redis.setex(
            `peer:${peerId}:location`,
            60,
            JSON.stringify(peer.location)
          );
        }
        // Relay location to nearby peers
        await this.relayLocation(peerId, peer.location);
        break;

      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice-candidate':
        // Relay WebRTC signaling to target peer
        await this.relayWebRTCMessage(peerId, message);
        break;

      case 'gps-data':
        // Store and relay GPS data
        await this.handleGPSData(peerId, message.data);
        break;

      case 'peer-discovery':
        this.sendPeerList(peerId);
        break;

      case 'ping':
        peer.lastPing = Date.now();
        this.sendToPeer(peerId, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  async relayLocation(peerId, location) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const rateLimitMs = this.locationRateLimitMs || 1000;
    const now = Date.now();
    if (peer.lastLocationRelay && (now - peer.lastLocationRelay) < rateLimitMs) {
      logger.warn(`WebRTC location relay rate limited for peer ${peerId}`);
      return;
    }
    peer.lastLocationRelay = now;

    const meshId = peer.meshId;
    const peersInMesh = this.meshes.get(meshId) || new Set();
    const relayRadius = this.locationRelayRadius || 50;
    const maxRadius = this.maxRelayRadius || 200;

    const sourceLoc = peer.location || (this.isValidLocation(location) ? this.normalizeLocation(location) : null);

    for (const targetPeerId of peersInMesh) {
      if (targetPeerId === peerId) continue;
      const targetPeer = this.peers.get(targetPeerId);
      if (!targetPeer || targetPeer.ws.readyState !== 1) continue;

      const payloadLocation = this.getDisclosedLocation(
        sourceLoc || location,
        targetPeer.location,
        relayRadius,
        maxRadius
      );

      if (payloadLocation === null) continue;
      this.sendToPeer(targetPeerId, {
        type: 'peer-location',
        peerId,
        location: payloadLocation,
        timestamp: Date.now()
      });
    }
  }

  async relayWebRTCMessage(fromPeerId, message) {
    const { targetPeerId, data } = message;
    const sourcePeer = this.peers.get(fromPeerId);
    const targetPeer = this.peers.get(targetPeerId);

    if (!sourcePeer || !targetPeer) {
      logger.warn(`WebRTC relay blocked for missing peer: ${fromPeerId} -> ${targetPeerId}`);
      return;
    }

    if (sourcePeer.meshId !== targetPeer.meshId) {
      logger.warn(`WebRTC relay blocked across meshes: ${fromPeerId} -> ${targetPeerId}`);
      return;
    }

    if (targetPeer.ws.readyState === 1) {
      this.sendToPeer(targetPeerId, {
        ...data,
        fromPeerId
      });
    }
  }

  getDisclosedLocation(sourceLocation, recipientLocation, relayRadius, maxRadius) {
    if (!sourceLocation) return null;

    if (recipientLocation && this.isValidLocation(recipientLocation) && this.isValidLocation(sourceLocation)) {
      const distance = this.calculateDistance(
        sourceLocation.lat,
        sourceLocation.lng,
        recipientLocation.lat,
        recipientLocation.lng
      );

      if (distance <= relayRadius) return sourceLocation;
      if (distance <= maxRadius) return this.capPrecision(sourceLocation, 2);
      return null;
    }

    return this.capPrecision(sourceLocation, 2);
  }

  isValidLocation(location) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    return Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;
  }

  normalizeLocation(location) {
    if (location == null) {
      throw new TypeError('normalizeLocation: location must not be null or undefined');
    }
    return {
      ...location,
      lat: Number(location.lat),
      lng: Number(location.lng)
    };
  }

  async handleGPSData(peerId, data) {
    if (!data || typeof data !== 'object' || !this.isValidLocation(data.location)) {
      logger.warn(`Invalid WebRTC GPS payload dropped for peer ${peerId}`);
      return;
    }

    const peer = this.peers.get(peerId);
    if (!peer) {
      logger.warn(`[WebRTC] GPS data from unknown peer ${peerId}`);
      return;
    }

    // Use an authenticated Supabase client for GPS data inserts (RLS requires authenticated role)
    const userClient = peer.token ? createUserClient(peer.token) : null;
    const gpsClient = userClient || supabase;

    const normalizedData = {
      ...data,
      location: this.normalizeLocation(data.location)
    };

    // Store GPS data in MongoDB with offline sync flag
    const gpsEntry = {
      peerId,
      data: normalizedData,
      timestamp: Date.now(),
      synced: false
    };

    try {
      const { error } = await gpsClient.from('gps_offline_data').insert([gpsEntry]);
      if (error) {
        logger.warn(`Failed to persist WebRTC GPS payload for peer ${peerId}: ${error.message}`);
      }
    } catch (err) {
      logger.warn(`Failed to persist WebRTC GPS payload for peer ${peerId}: ${err.message}`);
    }

    // Store locally in Redis for quick access
    try {
      if (this.redis) {
        await this.redis.setex(
          `gps:${peerId}:latest`,
          300,
          JSON.stringify(normalizedData)
        );
      }
    } catch (err) {
      logger.warn(`Failed to cache WebRTC GPS payload for peer ${peerId}: ${err.message}`);
    }

    // Relayed to peers in mesh
    await this.relayLocation(peerId, normalizedData.location);
  }

  async handleDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      const meshId = peer.meshId;
      if (this.meshes.has(meshId)) {
        const mesh = this.meshes.get(meshId);
        mesh.delete(peerId);
        if (mesh.size === 0) {
          this.meshes.delete(meshId);
        }
      }
      this.peers.delete(peerId);
      logger.info(`🔌 Peer ${peerId} disconnected`);
    }
  }

  sendToPeer(peerId, message) {
    const peer = this.peers.get(peerId);
    if (peer && peer.ws.readyState === 1) {
      peer.ws.send(JSON.stringify(message));
    }
  }

  sendPeerList(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const meshId = peer.meshId;
    const peersInMesh = this.meshes.get(meshId) || new Set();
    const peerList = [];

    for (const targetPeerId of peersInMesh) {
      if (targetPeerId === peerId) continue;
      const targetPeer = this.peers.get(targetPeerId);
      if (targetPeer) {
        const location = this.getDisclosedLocation(
          targetPeer.location,
          peer.location,
          this.locationRelayRadius || 50,
          this.maxRelayRadius || 200
        );

        peerList.push({
          peerId: targetPeerId,
          ...(location ? { location } : {}),
          connectedAt: targetPeer.connectedAt
        });
      }
    }

    this.sendToPeer(peerId, {
      type: 'peer-list',
      peers: peerList,
      count: peerList.length
    });
  }

  getOrCreateMesh() {
    const limit = this.maxMeshes || 10000;
    if (this.meshes.size >= limit) {
      return null;
    }
    const meshId = `mesh_${crypto.randomUUID()}`;
    this.meshes.set(meshId, new Set());
    return meshId;
  }

  generatePeerId() {
    return `peer_${crypto.randomUUID()}`;
  }

  startDiscovery() {
    this._discoveryInterval = setInterval(() => {
      for (const [peerId, peer] of this.peers) {
        if (peer.ws.readyState === 1) {
          this.sendPeerList(peerId);
        }
      }
    }, 30000);
  }

  destroy() {
    if (this._discoveryInterval) {
      clearInterval(this._discoveryInterval);
      this._discoveryInterval = null;
    }
    for (const [peerId, peer] of this.peers) {
      try {
        peer.ws.close(1001, 'Server shutting down');
      } catch (err) {
        logger.warn(
          { err },
          '[WebRTC] Failed to close peer WebSocket during shutdown.'
        );
      }
    }
    this.peers.clear();
    this.meshes.clear();
    this.wss.close();
  }

  async getPeersNearLocation(lat, lng, radius = 10, requestingUser) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TypeError('Latitude and longitude must be finite numbers');
    }

    const isAdmin = requestingUser?.role === 'admin';
    let searchLat = lat;
    let searchLng = lng;
    let searchRadius = radius;
    let authorizedMeshIds = null;

    if (!isAdmin) {
      if (!requestingUser?.id) {
        const error = new Error('Authenticated user identity is required');
        error.statusCode = 403;
        throw error;
      }

      const requestingPeers = Array.from(this.peers.values()).filter(
        (peer) =>
          peer.userId === requestingUser.id &&
          peer.meshId &&
          peer.location &&
          this.isValidLocation(peer.location),
      );

      if (requestingPeers.length === 0) {
        const error = new Error('An active location is required for nearby peer discovery');
        error.statusCode = 403;
        throw error;
      }

      authorizedMeshIds = new Set(requestingPeers.map((peer) => peer.meshId));
      const requestingPeer = requestingPeers[0];

      searchLat = requestingPeer.location.lat;
      searchLng = requestingPeer.location.lng;
      searchRadius = 10;
    }

    const nearbyPeers = [];
    for (const [peerId, peer] of this.peers) {
      if (
        !peer.location ||
        (requestingUser && requestingUser.role !== 'admin' &&
          !authorizedMeshIds.has(peer.meshId)) ||
        (requestingUser?.id && peer.userId === requestingUser.id)
      ) continue;

      const distance = this.calculateDistance(
        searchLat,
        searchLng,
        peer.location.lat,
        peer.location.lng,
      );

      if (distance <= searchRadius) {
        nearbyPeers.push({
          peerId,
          location: peer.location,
          distance,
        });
      }
    }

    if (isAdmin) return nearbyPeers;
    if (nearbyPeers.length < 3) return [];

    return nearbyPeers.map((peer) => ({
      peerId: peer.peerId,
      location: this.capPrecision(peer.location, 2),
      distance: Math.round(peer.distance / 5) * 5,
    }));
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    if (
      !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
      !Number.isFinite(lat2) || !Number.isFinite(lng2)
    ) {
      throw new TypeError('calculateDistance: all coordinates must be finite numbers');
    }
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  getStats() {
    return {
      totalPeers: this.peers.size,
      totalMeshes: this.meshes.size,
      peersPerMesh: Array.from(this.meshes.entries()).map(([id, set]) => ({
        meshId: id,
        peerCount: set.size
      }))
    };
  }

  canUserAccessPeer(peerId, user) {
    if (user?.role === 'admin') return true;

    const peer = this.peers.get(peerId);
    return Boolean(peer && peer.userId === user?.id);
  }

  async getOfflineGPSData(peerId, since, requestingUser) {
    if (!requestingUser || !this.canUserAccessPeer(peerId, requestingUser)) {
      logger.warn(`[WebRTC] Unauthorized offline GPS data access attempt for peer ${peerId}`);
      return [];
    }
    let query = supabase
      .from('gps_offline_data')
      .select('id, data, timestamp, synced')
      .eq('peerId', peerId)
      .gt('timestamp', since || 0)
      .order('timestamp', { ascending: true });

    if (typeof query?.limit === 'function') {
      query = query.limit(OFFLINE_GPS_PAGE_SIZE);
    }

    const { data } = await query;

    return data || [];
  }

  async syncOfflineData(peerId, arg2, arg3) {
    const requestingUser = arg3 !== undefined ? arg3 : arg2;
    const ackedIds = Array.isArray(arg2) ? arg2 : null;

    if (!requestingUser || !this.canUserAccessPeer(peerId, requestingUser)) {
      logger.warn(`[WebRTC] Unauthorized sync offline data attempt for peer ${peerId}`);
      return;
    }

    let query = supabase
      .from('gps_offline_data')
      .update({ synced: true })
      .eq('peerId', peerId);

    if (ackedIds && ackedIds.length > 0) {
      query = query.in('id', ackedIds);
    } else {
      query = query.eq('synced', false);
    }
    await query;
  }
}

export default WebRTCSignalingServer;
