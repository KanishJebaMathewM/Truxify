import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import shardManager from '../src/services/sharding/ShardManager.js';

describe('Shard Manager', () => {
  beforeAll(async () => {
    // Wait for shards to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await shardManager.closeAllConnections();
  });

  it('should get correct shard for Delhi location', () => {
    const shard = shardManager.getShardForLocation(28.6139, 77.2090);
    expect(shard).toBe('north');
  });

  it('should get correct shard for Chennai location', () => {
    const shard = shardManager.getShardForLocation(13.0827, 80.2707);
    expect(shard).toBe('south');
  });

  it('should get correct shard for Mumbai location', () => {
    const shard = shardManager.getShardForLocation(19.0760, 72.8777);
    expect(shard).toBe('west');
  });

  it('should get correct shard for Kolkata location', () => {
    const shard = shardManager.getShardForLocation(22.5726, 88.3639);
    expect(shard).toBe('east');
  });

  it('should return all shards in health check', async () => {
    const status = await shardManager.healthCheck();
    expect(Object.keys(status)).toHaveLength(4);
    expect(status).toHaveProperty('north');
    expect(status).toHaveProperty('south');
    expect(status).toHaveProperty('east');
    expect(status).toHaveProperty('west');
  });
});