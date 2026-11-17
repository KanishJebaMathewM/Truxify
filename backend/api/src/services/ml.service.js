// backend/api/src/services/ml.service.js

import axios from 'axios';
import CircuitBreaker from 'opossum';
import logger from '../middleware/logger.js';
import { getCorrelationId } from '../middleware/correlationId.js';

const ML_BASE_URL = process.env.ML_ENGINE_URL || 'http://localhost:8000';

async function callMLEndpoint(endpoint, payload) {
  const correlationId = getCorrelationId();
  const response = await axios.post(`${ML_BASE_URL}/${endpoint}`, payload, {
    timeout: 3000, // 3s hard timeout
    headers: {
      'Authorization': `Bearer ${process.env.ML_API_KEY || ''}`,
      'Content-Type': 'application/json',
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    },
  });
  return response.data;
}

const breakerOptions = {
  timeout: 3000,               // If request takes longer than 3s, trigger timeout failure
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000,         // Try closing circuit again after 30s
};

const mlBreaker = new CircuitBreaker(async (endpoint, payload) => {
  return await callMLEndpoint(endpoint, payload);
}, breakerOptions);

// Fallback strategy: Rule-based proximity & availability sort
mlBreaker.fallback((endpoint, payload, err) => {
  logger.warn({ err: err?.message, endpoint }, '[ML Fallback] Circuit breaker open or request timed out. Executing rule-based fallback.');
  
  // Return graceful fallback response with sorted nearby trucks
  const nearbyTrucks = payload?.nearby_trucks || [];
  const sortedFallbackTrucks = [...nearbyTrucks].sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));

  return {
    fallback: true,
    reason: err?.message || 'ML service unavailable',
    ranked_trucks: sortedFallbackTrucks.slice(0, 5),
  };
});

mlBreaker.on('open', () => logger.warn('[CircuitBreaker] ML Service breaker state: OPEN'));
mlBreaker.on('halfOpen', () => logger.info('[CircuitBreaker] ML Service breaker state: HALF-OPEN'));
mlBreaker.on('close', () => logger.info('[CircuitBreaker] ML Service breaker state: CLOSED'));

export async function predictMatchOrPricing(endpoint, payload) {
  return await mlBreaker.fire(endpoint, payload);
}
