// backend/api/src/services/telemetryService.js

import logger from '../middleware/logger.js';
import { getCacheItem, setCacheItem } from '../cache/CacheManager.js';

/**
 * Ingests a driver location update ensuring out-of-order and stale updates are rejected.
 * @param {string} driverId - Unique driver identifier.
 * @param {Object} locationPayload - Incoming location data { latitude, longitude, timestamp, sequenceNumber }.
 * @returns {Promise<Object>} Status result of the telemetry ingestion.
 */
export async function updateDriverLocation(driverId, locationPayload) {
  if (!driverId || !locationPayload) {
    throw new Error('Driver ID and location payload are required');
  }

  const { latitude, longitude, timestamp, sequenceNumber } = locationPayload;
  
  const incomingTimestamp = Number(timestamp) || Date.now();
  const incomingSeq = Number(sequenceNumber) || incomingTimestamp;

  const cacheKey = `driver:location:latest:${driverId}`;
  const currentStored = await getCacheItem(cacheKey);

  if (currentStored) {
    const storedTimestamp = Number(currentStored.timestamp) || 0;
    const storedSeq = Number(currentStored.sequenceNumber) || storedTimestamp;

    // Reject out-of-order stale updates
    if (incomingSeq < storedSeq || (incomingSeq === storedSeq && incomingTimestamp <= storedTimestamp)) {
      logger.warn('Rejected stale or out-of-order driver location update', {
        driverId,
        incomingTimestamp,
        storedTimestamp,
        incomingSeq,
        storedSeq
      });
      return {
        success: true,
        updated: false,
        reason: 'STALE_OR_DUPLICATE_LOCATION',
        currentPosition: currentStored
      };
    }
  }

  // Construct new latest position envelope
  const updatedPosition = {
    latitude: Number(latitude),
    longitude: Number(longitude),
    timestamp: incomingTimestamp,
    sequenceNumber: incomingSeq,
    updatedAt: new Date().toISOString()
  };

  // Persist latest verified position to cache / active store
  // TTL of 24 hours for active shift tracking
  await setCacheItem(cacheKey, updatedPosition, 86400);

  logger.info('Driver location updated successfully', { driverId, timestamp: incomingTimestamp });

  return {
    success: true,
    updated: true,
    currentPosition: updatedPosition
  };
}
