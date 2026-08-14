import pkg from 'pg';
const { Pool } = pkg;
import logger from '../../middleware/logger.js';
import { redisClient, pgPool } from '../../config/db.js';

// Canonical state centroids (approximate) used to map coordinates to the
// nearest configured state. A nearest-centroid (Voronoi) assignment is
// inherently non-overlapping: every coordinate resolves to exactly one state,
// and every returned state key exists in a shard's `states` array so
// getShardForState never falls back to the default shard (issue #11394).
const STATE_CENTROIDS = [
  // North
  ['delhi', [28.6139, 77.209]],
  ['up', [26.8, 80.9]],
  ['punjab', [31.0, 75.0]],
  ['haryana', [29.0, 76.0]],
  ['rajasthan', [27.0, 74.0]],
  ['j&k', [33.5, 75.5]],
  ['himachal', [31.5, 77.5]],
  ['uttarakhand', [30.0, 79.0]],
  // South
  ['tamilnadu', [11.0, 78.5]],
  ['karnataka', [15.0, 75.5]],
  ['kerala', [10.5, 76.5]],
  ['andhra', [16.0, 80.0]],
  ['telangana', [18.0, 79.0]],
  ['pondicherry', [11.9, 79.8]],
  // East
  ['westbengal', [23.0, 87.5]],
  ['bihar', [25.6, 85.1]],
  ['odisha', [20.5, 85.5]],
  ['jharkhand', [23.5, 85.5]],
  ['assam', [26.2, 92.0]],
  ['sikkim', [27.3, 88.5]],
  ['nagaland', [26.0, 94.5]],
  ['manipur', [24.5, 93.8]],
  ['meghalaya', [25.5, 91.5]],
  ['mizoram', [23.5, 92.8]],
  ['arunachal', [28.0, 94.5]],
  ['tripura', [23.8, 91.8]],
  // West
  ['maharashtra', [19.5, 75.5]],
  ['gujarat', [22.5, 72.5]],
  ['madhyapradesh', [23.0, 78.5]],
  ['goa', [15.3, 74.1]],
  ['chhattisgarh', [21.5, 82.0]],
];

class ShardManager {
  constructor() {
    this.shards = new Map();
    this.redis = redisClient;
    this._isClosed = false;
    this.initializeShards();
  }

  initializeShards() {
    const missingPasswords = [];

    // North Zone - Delhi, UP, Punjab, Haryana, Rajasthan
    const northPassword = process.env.SHARD_PASSWORD_NORTH;
    if (!northPassword) missingPasswords.push('SHARD_PASSWORD_NORTH');
    this.shards.set('north', {
      name: 'north',
      states: ['delhi', 'up', 'punjab', 'haryana', 'rajasthan', 'j&k', 'himachal', 'uttarakhand'],
      host: process.env.SHARD_NORTH_HOST || 'localhost',
      port: process.env.SHARD_NORTH_PORT || 5432,
      database: process.env.SHARD_NORTH_DB || 'truxify_north',
      user: process.env.SHARD_NORTH_USER || 'postgres',
      password: northPassword || null,
      pool: null
    });

    // South Zone - Tamil Nadu, Karnataka, Kerala, AP, Telangana
    const southPassword = process.env.SHARD_PASSWORD_SOUTH;
    if (!southPassword) missingPasswords.push('SHARD_PASSWORD_SOUTH');
    this.shards.set('south', {
      name: 'south',
      states: ['tamilnadu', 'karnataka', 'kerala', 'andhra', 'telangana', 'pondicherry'],
      host: process.env.SHARD_SOUTH_HOST || 'localhost',
      port: process.env.SHARD_SOUTH_PORT || 5433,
      database: process.env.SHARD_SOUTH_DB || 'truxify_south',
      user: process.env.SHARD_SOUTH_USER || 'postgres',
      password: southPassword || null,
      pool: null
    });

    // East Zone - WB, Bihar, Odisha, Jharkhand, NE States
    const eastPassword = process.env.SHARD_PASSWORD_EAST;
    if (!eastPassword) missingPasswords.push('SHARD_PASSWORD_EAST');
    this.shards.set('east', {
      name: 'east',
      states: ['westbengal', 'bihar', 'odisha', 'jharkhand', 'assam', 'sikkim', 'nagaland', 'manipur', 'meghalaya', 'mizoram', 'arunachal', 'tripura'],
      host: process.env.SHARD_EAST_HOST || 'localhost',
      port: process.env.SHARD_EAST_PORT || 5434,
      database: process.env.SHARD_EAST_DB || 'truxify_east',
      user: process.env.SHARD_EAST_USER || 'postgres',
      password: eastPassword || null,
      pool: null
    });

    // West Zone - Maharashtra, Gujarat, MP, Goa
    const westPassword = process.env.SHARD_PASSWORD_WEST;
    if (!westPassword) missingPasswords.push('SHARD_PASSWORD_WEST');
    this.shards.set('west', {
      name: 'west',
      states: ['maharashtra', 'gujarat', 'madhyapradesh', 'goa', 'chhattisgarh'],
      host: process.env.SHARD_WEST_HOST || 'localhost',
      port: process.env.SHARD_WEST_PORT || 5435,
      database: process.env.SHARD_WEST_DB || 'truxify_west',
      user: process.env.SHARD_WEST_USER || 'postgres',
      password: westPassword || null,
      pool: null
    });

    if (missingPasswords.length > 0) {
      throw new Error(`Missing required shard password env vars: ${missingPasswords.join(', ')}`);
    }

    // Initialize connection pools
    this.initializePools();
  }

  initializePools() {
    for (const [name, config] of this.shards) {
      try {
        config.pool = new Pool({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          max: 10,
        });
        logger.info(`[OK] Shard ${name} initialized`);
      } catch (error) {
        logger.error(`[ERROR] Failed to initialize shard ${name}:`, error);
      }
    }
  }

  getShardForLocation(lat, lng) {
    // Determine state from coordinates using reverse geocoding
    // For now, use a simple lookup based on lat/lng bounds
    const state = this.getStateFromCoordinates(lat, lng);
    return this.getShardForState(state);
  }

  getShardForState(state) {
    const stateLower = state.toLowerCase();
    for (const [name, config] of this.shards) {
      if (config.states.includes(stateLower)) {
        return name;
      }
    }
    // Default to north shard
    return 'north';
  }

  getStateFromCoordinates(lat, lng) {
    // Map coordinates to the nearest canonical state centroid. This replaces the
    // previous overlapping bounding boxes that could never return several
    // configured states (e.g. kerala, andhra, bihar, goa, odisha) and that
    // mis-routed Bihar (Patna) to the north shard (issue #11394).
    if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
      return process.env.DEFAULT_SHARD_STATE || 'delhi';
    }
    let bestState = process.env.DEFAULT_SHARD_STATE || 'delhi';
    let bestDist = Infinity;
    for (const [state, centroid] of STATE_CENTROIDS) {
      const dLat = lat - centroid[0];
      const dLng = lng - centroid[1];
      const dist = dLat * dLat + dLng * dLng;
      if (dist < bestDist) {
        bestDist = dist;
        bestState = state;
      }
    }
    return bestState;
  }

  async getConnectionForOrder(orderId) {
    // Get order location from cache or database
    const location = await this.getOrderLocation(orderId);
    if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
      const shardName = this.getShardForLocation(location.lat, location.lng);
      return this.getShardConnection(shardName);
    }
    // No resolvable coordinates — route by the configured/default state rather
    // than pinning every unknown order to a constant.
    const state = (location && location.state) || process.env.DEFAULT_SHARD_STATE || 'delhi';
    return this.getShardConnection(this.getShardForState(state));
  }

  async getShardConnection(shardName) {
    const shard = this.shards.get(shardName);
    if (shard && shard.pool) {
      return shard.pool;
    }
    logger.error(`Shard ${shardName} not available, falling back to north`);
    const north = this.shards.get('north');
    if (north && north.pool) {
      return north.pool;
    }
    throw new Error(`No database shard available (requested: ${shardName}, north fallback also unavailable)`);
  }

  async getOrderLocation(orderId) {
    // Check cache first
    const cached = await this.redis.get(`order:${orderId}:location`);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (err) {
        // Corrupt cache entry — fall through to the authoritative lookup
        // instead of throwing (issue #12751).
        logger.warn(`[ShardManager] Corrupt cached location for order ${orderId}, falling back to database: ${err.message}`);
      }
    }
    // Resolve the real pickup location from the authoritative orders table when
    // a primary PostgreSQL connection is configured. This prevents every
    // uncached order from being silently pinned to a hard-coded location
    // (issue #11394). The lookup is best-effort: on any failure we fall back to
    // the configurable default state instead of a constant.
    if (pgPool) {
      try {
        const { rows } = await pgPool.query(
          'SELECT pickup_lat, pickup_lng FROM orders WHERE id = $1 LIMIT 1',
          [orderId]
        );
        if (rows.length > 0 && rows[0].pickup_lat != null && rows[0].pickup_lng != null) {
          return {
            lat: Number(rows[0].pickup_lat),
            lng: Number(rows[0].pickup_lng),
          };
        }
      } catch (err) {
        logger.warn(`[ShardManager] Failed to resolve location for order ${orderId}: ${err.message}`);
      }
    }
    // Truly unknown: fall back to the configurable default state.
    return { lat: null, lng: null, state: process.env.DEFAULT_SHARD_STATE || 'delhi' };
  }

  async executeQuery(query, params = [], shardName = null) {
    let connection;
    try {
      if (shardName) {
        connection = await this.getShardConnection(shardName);
      } else {
        // Default to north shard
        connection = await this.getShardConnection('north');
      }
      // node-postgres (`pg`) Pool exposes `.query()`, not `.execute()` (that's
      // the mysql2 API). `.query()` resolves to `{ rows, rowCount, ... }`,
      // not a `[rows, fields]` tuple.
      const result = await connection.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Query execution error:', error);
      throw error;
    }
  }

  async executeCrossShardQuery(queries) {
    // Execute same query across all shards and combine results
    const results = [];
    for (const [name, shard] of this.shards) {
      if (shard.pool) {
        try {
          const result = await shard.pool.query(queries.query, queries.params || []);
          results.push({ shard: name, data: result.rows });
        } catch (error) {
          logger.error(`Error querying shard ${name}:`, error);
        }
      }
    }
    return results;
  }

  async healthCheck() {
    const status = {};
    for (const [name, shard] of this.shards) {
      try {
        if (shard.pool) {
          await shard.pool.query('SELECT 1');
          status[name] = 'healthy';
        } else {
          status[name] = 'uninitialized';
        }
      } catch (error) {
        status[name] = 'unhealthy';
        logger.error(`Shard ${name} health check failed:`, error);
      }
    }
    return status;
  }

  async closeAllConnections() {
    if (this._isClosed) return;
    this._isClosed = true;
    for (const [name, shard] of this.shards) {
      if (shard.pool) {
        await shard.pool.end();
        logger.info(`Closed shard ${name} connections`);
      }
    }
  }
}

export default new ShardManager();
