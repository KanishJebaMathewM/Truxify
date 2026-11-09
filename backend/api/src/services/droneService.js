import crypto from 'crypto';
import logger from '../middleware/logger.js';

export const MAX_ACTIVE_DRONE_MISSIONS = 200;
export const TERMINAL_MISSION_RETENTION_MS = 30 * 60 * 1000;
export const STALE_MISSION_TTL_MS = 6 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set([
  'ABORTED_RETURNING_TO_BASE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/**
 * Service handling last-mile drone delivery handoffs and real-time telemetry tracking.
 */
class DroneService {
  constructor() {
    this.activeMissions = new Map();
  }

  pruneExpiredMissions(now = Date.now()) {
    let removed = 0;
    for (const [missionId, mission] of this.activeMissions) {
      const createdAt = Date.parse(mission.createdAt);
      if (!Number.isFinite(createdAt)) {
        this.activeMissions.delete(missionId);
        removed += 1;
        continue;
      }

      const ageMs = now - createdAt;
      const isTerminal = TERMINAL_STATUSES.has(mission.status);
      const terminalAt = Date.parse(mission.abortedAt || mission.createdAt);
      const terminalAgeMs = Number.isFinite(terminalAt) ? now - terminalAt : ageMs;
      if (
        (isTerminal && terminalAgeMs > TERMINAL_MISSION_RETENTION_MS) ||
        ageMs > STALE_MISSION_TTL_MS
      ) {
        this.activeMissions.delete(missionId);
        removed += 1;
      }
    }
    return removed;
  }

  clearMissions() {
    this.activeMissions.clear();
  }

  getMissionCount() {
    return this.activeMissions.size;
  }

  /**
   * Initiates a drone launch for last-mile delivery handoff.
   * @param {Object} params
  * @param {string} params.ownerId
  * @param {string} params.tripId
   * @param {string} params.parcelId
   * @param {Object} params.safeZoneGps - { lat, lng }
   * @param {Object} params.destinationGps - { lat, lng }
   * @returns {Object} Mission dispatch details
   */
  async launchDroneDelivery({ ownerId, tripId, parcelId, safeZoneGps, destinationGps }) {
    if (!ownerId || !tripId || !parcelId) {
      throw new Error('ownerId, tripId, and parcelId are required');
    }
    const droneId = `DRN-AeroX-${crypto.randomInt(10, 100)}`;
    const missionId = `MSN-${crypto.randomUUID()}`;

    const missionData = {
      missionId,
      ownerId,
      droneId,
      tripId,
      parcelId,
      status: 'DISPATCHED',
      safeZoneGps,
      destinationGps,
      batteryPercent: 100,
      distanceToDestinationKm: 2.5,
      estimatedArrivalMinutes: 5,
      createdAt: new Date().toISOString()
    };

    this.pruneExpiredMissions();
    if (this.activeMissions.size >= MAX_ACTIVE_DRONE_MISSIONS) {
      const error = new Error('Drone mission capacity reached; try again later');
      error.statusCode = 429;
      throw error;
    }

    this.activeMissions.set(missionId, missionData);
    logger.info(`[DroneService] Launched drone mission ${missionId} with drone ${droneId}`);

    return missionData;
  }

  /**
   * Retrieves real-time telemetry for an active drone mission.
   * @param {string} missionId
   * @returns {Object|null} Telemetry details
   */
  async getDroneTelemetry(missionId, ownerId) {
    this.pruneExpiredMissions();
    const mission = this.activeMissions.get(missionId);
    if (!mission) {
      return null;
    }
    if (ownerId && mission.ownerId !== ownerId) {
      return null;
    }
    return {
      ...mission,
      lastTelemetryUpdate: new Date().toISOString()
    };
  }

  async abortMission(missionId, ownerId) {
    this.pruneExpiredMissions();
    const mission = this.activeMissions.get(missionId);
    if (!mission || (ownerId && mission.ownerId !== ownerId)) {
      return null;
    }

    if (!TERMINAL_STATUSES.has(mission.status)) {
      mission.status = 'ABORTED_RETURNING_TO_BASE';
      mission.abortedAt = new Date().toISOString();
    }

    return {
      ...mission,
      lastTelemetryUpdate: new Date().toISOString()
    };
  }
}

export const droneService = new DroneService();
