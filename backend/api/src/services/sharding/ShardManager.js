import pkg from 'pg';
const { Pool } = pkg;
import logger from '../../middleware/logger.js';
import { redisClient } from '../../config/db.js';

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
    const northPassword = process.env.SHARD_NORTH_PASSWORD;
    if (!northPassword) missingPasswords.push('SHARD_NORTH_PASSWORD');
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
    const southPassword = process.env.SHARD_SOUTH_PASSWORD;
    if (!southPassword) missingPasswords.push('SHARD_SOUTH_PASSWORD');
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
    const eastPassword = process.env.SHARD_EAST_PASSWORD;
    if (!eastPassword) missingPasswords.push('SHARD_EAST_PASSWORD');
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
    const westPassword = process.env.SHARD_WEST_PASSWORD;
    if (!westPassword) missingPasswords.push('SHARD_WEST_PASSWORD');
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
        logger.info(`✅ Shard ${name} initialized`);
      } catch (error) {
        logger.error(`❌ Failed to initialize shard ${name}:`, error);
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
    // Simplified: Map coordinates to states
    // In production, use reverse geocoding API
    if (lat > 24 && lat < 36 && lng > 68 && lng < 88) return 'delhi';
    // Maharashtra must be checked before Tamil Nadu since Mumbai's coordinates
    // (lat ~19, lng ~73) would otherwise match the Tamil Nadu bounding box
    if (lat > 16 && lat < 24 && lng > 68 && lng < 78) return 'maharashtra';
    if (lat > 8 && lat < 20 && lng > 72 && lng < 82) return 'tamilnadu';
    // North-East must be checked before West Bengal since Guwahati (Assam, ~26, ~91)
    // lies within the West Bengal bounding box
    if (lat > 25 && lat < 28 && lng > 90 && lng < 97) return 'assam';
    if (lat > 20 && lat < 28 && lng > 82 && lng < 92) return 'westbengal';
    return 'delhi';
  }

  async getConnectionForOrder(orderId) {
    // Get order location from cache or database
    const location = await this.getOrderLocation(orderId);
    if (location) {
      const shardName = this.getShardForLocation(location.lat, location.lng);
      return this.getShardConnection(shardName);
    }
    return this.getShardConnection('north');
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
      return JSON.parse(cached);
    }
    // In production, fetch from main DB
    return { lat: 28.6139, lng: 77.2090 };
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
