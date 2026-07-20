import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import logger from '../../middleware/logger.js';
import { supabase, redisClient } from '../../config/db.js';

class WebRTCSignalingServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: '/webrtc' });
    this.redis = redisClient;
    this.peers = new Map(); // peerId -> { ws, location, meshId }
    this.meshes = new Map(); // meshId -> Set of peerIds
    
    this.setupWebSocket();
    this.startDiscovery();
    
    logger.info('✅ WebRTC Signaling Server initialized');
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // Authenticate via token query parameter or Authorization header
      const token = url.searchParams.get('token')
        || req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        logger.warn('WebRTC connection rejected: no token provided');
        ws.close(4001, 'Authentication required');
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        logger.warn(`WebRTC connection rejected: invalid token — ${err.message}`);
        ws.close(4001, 'Invalid token');
        return;
      }

      const peerId = this.generatePeerId();
      const meshId = url.searchParams.get('meshId') || this.getOrCreateMesh();

      // Store peer with authenticated user info
      this.peers.set(peerId, {
        ws,
        userId: decoded.sub,
        role: decoded.role,
        location: null,
        meshId,
        connectedAt: Date.now(),
        lastPing: Date.now()
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
        logger.warn('WebSocket error for peer %s: %s', peerId, err.message);
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
        peer.location = message.location;
        await this.redis.setex(
          `peer:${peerId}:location`,
          60,
          JSON.stringify(message.location)
        );
        // Relay location to nearby peers
        this.relayLocation(peerId, message.location);
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

    const meshId = peer.meshId;
    const peersInMesh = this.meshes.get(meshId) || new Set();

    for (const targetPeerId of peersInMesh) {
      if (targetPeerId === peerId) continue;
      const targetPeer = this.peers.get(targetPeerId);
      if (targetPeer && targetPeer.ws.readyState === 1) {
        this.sendToPeer(targetPeerId, {
          type: 'peer-location',
          peerId,
          location,
          timestamp: Date.now()
        });
      }
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

    // Store in MongoDB
    await supabase.from('gps_offline_data').insert([gpsEntry]);

    // Store locally in Redis for quick access
    await this.redis.setex(
      `gps:${peerId}:latest`,
      300,
      JSON.stringify(normalizedData)
    );

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
        peerList.push({
          peerId: targetPeerId,
          location: targetPeer.location,
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
    const meshId = `mesh_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.meshes.set(meshId, new Set());
    return meshId;
  }

  generatePeerId() {
    return `peer_${Date.now()}_${Math.random().toString(36).substring(7)}`;
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
      try { peer.ws.close(1001, 'Server shutting down'); } catch {}
    }
    this.peers.clear();
    this.meshes.clear();
    this.wss.close();
  }

  async getPeersNearLocation(lat, lng, radius = 10) {
    const nearbyPeers = [];
    for (const [peerId, peer] of this.peers) {
      if (peer.location) {
        const distance = this.calculateDistance(
          lat, lng,
          peer.location.lat, peer.location.lng
        );
        if (distance <= radius) {
          nearbyPeers.push({
            peerId,
            location: peer.location,
            distance
          });
        }
      }
    }
    return nearbyPeers;
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
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

  async getOfflineGPSData(peerId, since) {
    const { data } = await supabase
      .from('gps_offline_data')
      .select('*')
      .eq('peerId', peerId)
      .gt('timestamp', since || 0)
      .order('timestamp', { ascending: true });
    
    return data || [];
  }

  async syncOfflineData(peerId) {
    // Mark data as synced for this peer
    await supabase
      .from('gps_offline_data')
      .update({ synced: true })
      .eq('peerId', peerId)
      .eq('synced', false);
  }
}

export default WebRTCSignalingServer;
