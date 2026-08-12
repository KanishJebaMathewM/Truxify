import { HealthAggregator } from './HealthAggregator.js';
import { HealthStatus, executeCheck, withTimeout } from './HealthCheck.js';

import supabaseHealth from './checks/supabaseHealth.js';
import mongodbHealth from './checks/mongodbHealth.js';
import redisHealth from './checks/redisHealth.js';
import postgresHealth from './checks/postgresHealth.js';
import firebaseHealth from './checks/firebaseHealth.js';
import polygonHealth from './checks/polygonHealth.js';
import escrowHealth from './checks/escrowHealth.js';
import kafkaHealth from './checks/kafkaHealth.js';
import graphqlHealth from './checks/graphqlHealth.js';
import websocketHealth from './checks/websocketHealth.js';
import mlHealth from './checks/mlHealth.js';
import workerHealth from './checks/workerHealth.js';

/**
 * Create a pre-configured HealthAggregator with all service checks.
 *
 * @returns {import('./HealthAggregator.js').HealthAggregator}
 */
export function createDefaultAggregator() {
  const aggregator = new HealthAggregator();

  aggregator.register('supabase', () => supabaseHealth(), { critical: true });
  aggregator.register('mongodb', () => mongodbHealth(), { critical: true });
  aggregator.register('postgres', () => postgresHealth(), { critical: true });
  aggregator.register('redis', () => redisHealth(), { critical: false });
  aggregator.register('firebase', () => firebaseHealth(), { critical: false });
  aggregator.register('polygon', () => polygonHealth(), { critical: false });
  aggregator.register('escrow', () => escrowHealth(), { critical: false });
  aggregator.register('kafka', () => kafkaHealth(), { critical: false });
  aggregator.register('graphql', () => graphqlHealth(), { critical: false });
  aggregator.register('websocket', () => websocketHealth(), { critical: false });
  aggregator.register('ml_engine', () => mlHealth(), { critical: false });
  aggregator.register('workers', () => workerHealth(), { critical: false });

  return aggregator;
}

export { HealthAggregator, HealthStatus, executeCheck, withTimeout };
