import logger from '../../middleware/logger.js';
import { redisClient, supabase } from '../../config/db.js';

class FraudDetectionService {
  constructor() {
    this.redis = redisClient;
    if (!this.redis) {
      logger.warn('[FraudDetection] Redis not configured — behavior tracking will use Supabase only');
    }
    this.behavioralProfiles = new Map();
    this.fraudThreshold = parseFloat(process.env.FRAUD_THRESHOLD) || 0.7;
    this.riskScores = new Map();
    this._maxRiskScores = 10000;
    this._maxBehavioralProfiles = 5000;
    this._evictionFraction = 0.25;
    this._lastRiskScoresEviction = null;
    this._lastBehavioralProfilesEviction = null;
    this._totalRiskScoresEvicted = 0;
    this._totalBehavioralProfilesEvicted = 0;
    this._cleanupInterval = setInterval(() => this._evictStale(), 300_000); // every 5 min
    this._cleanupInterval.unref?.();
    
    // Initialize ML models (in production, load from FastAPI)
    this.models = {
      behavioral: null,
      network: null,
      transaction: null
    };
    
    logger.info('✅ Fraud Detection Service initialized');
  }

  // ============ Behavioral Fingerprinting ============
  async trackBehavior(userId, eventData) {
    try {
      const profile = await this.getOrCreateProfile(userId);
      
      // Update behavioral metrics
      profile.events.push({
        type: eventData.type,
        timestamp: Date.now(),
        data: eventData
      });

      // Keep last 100 events
      if (profile.events.length > 100) {
        profile.events.shift();
      }

      // Update behavioral patterns
      this.updateBehavioralPatterns(profile, eventData);
      
      // Store in Redis
      if (this.redis) {
        await this.redis.setex(
          `behavior:${userId}`,
          3600,
          JSON.stringify(profile)
        );
      } else {
        this.behavioralProfiles.set(userId, profile);
      }

      // Persist to Supabase to prevent data loss across Redis expirations
      const { error: dbErr } = await supabase
        .from('behavioral_profiles')
        .upsert({
          user_id: userId,
          events: profile.events,
          patterns: profile.patterns,
          last_activity: new Date(profile.lastActivity).toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (dbErr) {
        logger.error('[FraudDetection] Failed to persist behavioral profile to DB:', dbErr.message);
      }

      // Calculate risk score
      const riskScore = await this.calculateBehavioralRisk(profile);
      this.riskScores.set(userId, riskScore);

      if (this.riskScores.size > this._maxRiskScores) {
        this._evictStale();
      }

      return {
        userId,
        riskScore,
        profile: {
          eventCount: profile.events.length,
          lastActivity: profile.lastActivity
        }
      };
    } catch (error) {
      logger.error('Behavior tracking error:', error);
      return null;
    }
  }

  async getOrCreateProfile(userId) {
    // Check Redis cache
    const cached = this.redis ? await this.redis.get(`behavior:${userId}`) : null;
    if (cached) {
      return JSON.parse(cached);
    }

    // Check database
    const { data } = await supabase
      .from('behavioral_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (data) {
      return data;
    }

    // Create new profile
    return {
      userId,
      events: [],
      patterns: {
        typingSpeed: [],
        mouseMovements: [],
        deviceFingerprint: null,
        locationHistory: [],
        transactionPatterns: []
      },
      lastActivity: Date.now(),
      createdAt: Date.now()
    };
  }

  updateBehavioralPatterns(profile, eventData) {
    const patterns = profile.patterns;

    // Track typing speed
    if (eventData.type === 'typing') {
      patterns.typingSpeed.push({
        speed: eventData.wpm || 0,
        timestamp: Date.now()
      });
      // Keep last 50
      if (patterns.typingSpeed.length > 50) {
        patterns.typingSpeed.shift();
      }
    }

    // Track mouse movements
    if (eventData.type === 'mouse') {
      patterns.mouseMovements.push({
        path: eventData.path || [],
        timestamp: Date.now()
      });
      if (patterns.mouseMovements.length > 20) {
        patterns.mouseMovements.shift();
      }
    }

    // Track location
    if (eventData.type === 'location') {
      patterns.locationHistory.push({
        lat: eventData.lat,
        lng: eventData.lng,
        timestamp: Date.now()
      });
      if (patterns.locationHistory.length > 50) {
        patterns.locationHistory.shift();
      }
    }

    // Track transactions
    if (eventData.type === 'transaction') {
      patterns.transactionPatterns.push({
        amount: eventData.amount,
        type: eventData.transactionType,
        timestamp: Date.now()
      });
      if (patterns.transactionPatterns.length > 50) {
        patterns.transactionPatterns.shift();
      }
    }

    // Update device fingerprint
    if (eventData.type === 'device') {
      patterns.deviceFingerprint = eventData.fingerprint;
    }

    profile.lastActivity = Date.now();
  }

  async calculateBehavioralRisk(profile) {
    let riskScore = 0;
    const patterns = profile.patterns;

    // 1. Check typing speed anomalies
    if (patterns.typingSpeed.length > 10) {
      const speeds = patterns.typingSpeed.map(s => s.speed);
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const variance = speeds.reduce((a, b) => a + Math.pow(b - avgSpeed, 2), 0) / speeds.length;
      
      // High variance = suspicious (bot or multiple users)
      if (variance > 100) {
        riskScore += 0.2;
      }
    }

    // 2. Check location anomalies
    if (patterns.locationHistory.length > 10) {
      const locations = patterns.locationHistory;
      let distanceTraveled = 0;
      for (let i = 1; i < locations.length; i++) {
        distanceTraveled += this.calculateDistance(
          locations[i-1].lat, locations[i-1].lng,
          locations[i].lat, locations[i].lng
        );
      }
      
      // Impossible travel distance in short time
      if (distanceTraveled > 100) { // 100km in short time
        riskScore += 0.3;
      }
    }

    // 3. Check transaction patterns
    if (patterns.transactionPatterns.length > 10) {
      const amounts = patterns.transactionPatterns.map(t => t.amount);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const maxAmount = Math.max(...amounts);
      
      // Unusual large transactions
      if (maxAmount > avgAmount * 5) {
        riskScore += 0.2;
      }
    }

    // 4. Check event frequency
    if (profile.events.length > 50) {
      const timeSpan = Date.now() - profile.events[0].timestamp;
      const eventsPerMinute = (profile.events.length / (timeSpan / 60000));
      
      // Too many events = bot
      if (eventsPerMinute > 60) {
        riskScore += 0.3;
      }
    }

    return Math.min(riskScore, 1.0);
  }

  // ============ Network Analysis ============
  async analyzeNetwork(userId) {
    try {
      // Get user's connections
      const connections = await this.getUserConnections(userId);
      
      // Build graph
      const graph = await this.buildGraph(userId, connections);
      
      // Detect fraud rings
      const fraudRings = await this.detectFraudRings(graph);
      
      // Calculate network risk
      const networkRisk = await this.calculateNetworkRisk(userId, graph, fraudRings);
      
      return {
        userId,
        networkRisk,
        connections: connections.length,
        fraudRings: fraudRings.length,
        isInFraudRing: fraudRings.length > 0
      };
    } catch (error) {
      logger.error('Network analysis error:', error);
      return null;
    }
  }

  async getUserConnections(userId) {
    // Get all connections (orders, trips, shared routes)
    const { data: orders, error } = await supabase
      .from('orders')
      .select('customer_id, driver_id')
      .or(`customer_id.eq.${userId},driver_id.eq.${userId}`);

    if (error) {
      logger.error('Failed to load user fraud connections:', error);
      return [];
    }

    if (!Array.isArray(orders)) {
      return [];
    }

    const connections = new Set();
    orders.forEach(order => {
      if (order.customer_id === userId && order.driver_id) {
        connections.add(order.driver_id);
      } else if (order.driver_id === userId && order.customer_id) {
        connections.add(order.customer_id);
      }
    });

    return Array.from(connections);
  }

  async buildGraph(userId, connections) {
    const graph = {
      nodes: [userId, ...connections],
      edges: []
    };

    // Add edges between connected users
    for (const conn of connections) {
      graph.edges.push({
        from: userId,
        to: conn,
        weight: 1
      });
    }

    // Get second-degree connections
    for (const conn of connections) {
      const secondConn = await this.getUserConnections(conn);
      for (const sc of secondConn) {
        if (sc !== userId && !connections.includes(sc)) {
          graph.edges.push({
            from: conn,
            to: sc,
            weight: 0.5
          });
        }
      }
    }

    return graph;
  }

  async detectFraudRings(graph) {
    const fraudRings = [];
    const visited = new Set();

    // Simple clique detection
    for (const node of graph.nodes) {
      if (visited.has(node)) continue;
      
      const connections = graph.edges
        .filter(e => e.from === node || e.to === node)
        .map(e => e.from === node ? e.to : e.from);
      
      // Check for clique (all connected to each other)
      let isClique = true;
      for (const conn of connections) {
        for (const conn2 of connections) {
          if (conn !== conn2) {
            const hasEdge = graph.edges.some(e => 
              (e.from === conn && e.to === conn2) ||
              (e.from === conn2 && e.to === conn)
            );
            if (!hasEdge) {
              isClique = false;
              break;
            }
          }
        }
        if (!isClique) break;
      }

      if (isClique && connections.length >= 3) {
        fraudRings.push({
          members: [node, ...connections],
          size: connections.length + 1
        });
        connections.forEach(c => visited.add(c));
        visited.add(node);
      }
    }

    return fraudRings;
  }

  async calculateNetworkRisk(userId, graph, fraudRings) {
    let riskScore = 0;

    // 1. Too many connections in short time
    if (graph.nodes.length > 20) {
      riskScore += 0.2;
    }

    // 2. Part of fraud ring
    if (fraudRings.length > 0) {
      riskScore += 0.4;
    }

    // 3. Many connections with low transaction amounts
    const lowAmountConnections = graph.edges.filter(e => e.weight < 0.5);
    if (lowAmountConnections.length > 5) {
      riskScore += 0.2;
    }

    // 4. No legitimate connections
    if (graph.nodes.length > 0 && graph.edges.length === 0) {
      riskScore += 0.2;
    }

    return Math.min(riskScore, 1.0);
  }

  // ============ Real-Time Scoring ============
  async getRealTimeRisk(userId, transactionData) {
    try {
      // 1. Behavioral risk
      const behavioralRisk = await this.calculateBehavioralRisk(
        await this.getOrCreateProfile(userId)
      );

      // 2. Network risk
      const connections = await this.getUserConnections(userId);
      const graph = await this.buildGraph(userId, connections);
      const fraudRings = await this.detectFraudRings(graph);
      const networkRisk = await this.calculateNetworkRisk(userId, graph, fraudRings);

      // 3. Transaction risk
      const transactionRisk = this.calculateTransactionRisk(transactionData);

      // 4. Combined score
      const combinedScore = this.combineRiskScores(
        behavioralRisk,
        networkRisk,
        transactionRisk
      );

      // 5. Store risk score
      await this.storeRiskScore(userId, combinedScore, {
        behavioral: behavioralRisk,
        network: networkRisk,
        transaction: transactionRisk
      });

      return {
        userId,
        riskScore: combinedScore,
        riskLevel: this.getRiskLevel(combinedScore),
        components: {
          behavioral: behavioralRisk,
          network: networkRisk,
          transaction: transactionRisk
        },
        isSuspicious: combinedScore > this.fraudThreshold,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Real-time risk calculation error:', error);
      return null;
    }
  }

  calculateTransactionRisk(data) {
    let risk = 0;

    // Check transaction amount
    if (data.amount > 100000) {
      risk += 0.3;
    }

    // Check transaction frequency
    if (data.frequency > 10) {
      risk += 0.2;
    }

    // Check unusual time
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      risk += 0.2;
    }

    // Check device mismatch
    if (data.deviceChanged) {
      risk += 0.3;
    }

    return Math.min(risk, 1.0);
  }

  combineRiskScores(behavioral, network, transaction) {
    // Weighted average
    const weights = {
      behavioral: 0.4,
      network: 0.3,
      transaction: 0.3
    };

    return (
      behavioral * weights.behavioral +
      network * weights.network +
      transaction * weights.transaction
    );
  }

  getRiskLevel(score) {
    if (score < 0.3) return 'LOW';
    if (score < 0.5) return 'MEDIUM';
    if (score < 0.7) return 'HIGH';
    return 'CRITICAL';
  }

  async storeRiskScore(userId, score, components) {
    try {
      await supabase
        .from('fraud_risk_scores')
        .insert([{
          user_id: userId,
          risk_score: score,
          components: components,
          created_at: new Date().toISOString()
        }]);
    } catch (err) {
      logger.error(`[FraudDetection] Failed to store risk score for user ${userId}: ${err.message}`);
    }

    // Cache in Redis
    if (this.redis) {
      try {
        await this.redis.setex(
          `risk:${userId}`,
          3600,
          JSON.stringify({
            score,
            components,
            timestamp: Date.now()
          })
        );
      } catch (err) {
        logger.warn(`[FraudDetection] Failed to cache risk score for user ${userId}: ${err.message}`);
      }
    }
  }

  // ============ Auto-Review Queue ============
  async addToReviewQueue(userId, reason, riskScore) {
    try {
      const { data } = await supabase
        .from('fraud_review_queue')
        .insert([{
          user_id: userId,
          reason: reason,
          risk_score: riskScore,
          status: 'pending',
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      logger.info(`User ${userId} added to review queue`, { reason, riskScore });
      return data;
    } catch (error) {
      logger.error('Add to review queue error:', error);
      return null;
    }
  }

  async getReviewQueue(limit = 50) {
    const { data } = await supabase
      .from('fraud_review_queue')
      .select('*')
      .eq('status', 'pending')
      .order('risk_score', { ascending: false })
      .limit(limit);

    return data || [];
  }

  async resolveReview(reviewId, action, notes) {
    const { data } = await supabase
      .from('fraud_review_queue')
      .update({
        status: 'resolved',
        action: action,
        notes: notes,
        resolved_at: new Date().toISOString()
      })
      .eq('id', reviewId)
      .select()
      .single();

    return data;
  }

  // ============ Utility Functions ============
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  async getFraudStats() {
    const { data: scores } = await supabase
      .from('fraud_risk_scores')
      .select('risk_score, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    const safe = scores || [];

    const highRisk = safe.filter(s => s.risk_score > 0.7).length;
    const mediumRisk = safe.filter(s => s.risk_score > 0.4 && s.risk_score <= 0.7).length;
    const lowRisk = safe.filter(s => s.risk_score <= 0.4).length;

    return {
      total: safe.length,
      highRisk,
      mediumRisk,
      lowRisk,
      avgScore: safe.reduce((sum, s) => sum + s.risk_score, 0) / safe.length || 0
    };
  }

  _evictFromMap(map, maxSize, label) {
    if (map.size <= maxSize) return 0;

    const keys = [...map.keys()];
    const toDelete = keys.slice(0, Math.floor(keys.length * this._evictionFraction));
    toDelete.forEach(k => map.delete(k));

    logger.info(`[FraudDetection] Evicted ${toDelete.length} stale ${label} (remaining: ${map.size})`);
    return toDelete.length;
  }

  _evictStale() {
    if (this.riskScores.size > this._maxRiskScores) {
      const evicted = this._evictFromMap(this.riskScores, this._maxRiskScores, 'risk scores');
      this._totalRiskScoresEvicted += evicted;
      this._lastRiskScoresEviction = Date.now();
    }
    if (this.behavioralProfiles.size > this._maxBehavioralProfiles) {
      const evicted = this._evictFromMap(this.behavioralProfiles, this._maxBehavioralProfiles, 'behavioral profiles');
      this._totalBehavioralProfilesEvicted += evicted;
      this._lastBehavioralProfilesEviction = Date.now();
    }
  }

  getCacheStats() {
    return {
      riskScores: {
        size: this.riskScores.size,
        maxSize: this._maxRiskScores,
        utilization: (this.riskScores.size / this._maxRiskScores * 100).toFixed(1) + '%',
        totalEvicted: this._totalRiskScoresEvicted,
        lastEviction: this._lastRiskScoresEviction ? new Date(this._lastRiskScoresEviction).toISOString() : null,
      },
      behavioralProfiles: {
        size: this.behavioralProfiles.size,
        maxSize: this._maxBehavioralProfiles,
        utilization: (this.behavioralProfiles.size / this._maxBehavioralProfiles * 100).toFixed(1) + '%',
        totalEvicted: this._totalBehavioralProfilesEvicted,
        lastEviction: this._lastBehavioralProfilesEviction ? new Date(this._lastBehavioralProfilesEviction).toISOString() : null,
      },
    };
  }

  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    this.riskScores.clear();
    this.behavioralProfiles.clear();
    this._totalRiskScoresEvicted = 0;
    this._totalBehavioralProfilesEvicted = 0;
    this._lastRiskScoresEviction = null;
    this._lastBehavioralProfilesEviction = null;
  }
}

export default new FraudDetectionService();
