import logger from '../middleware/logger.js';

/**
 * Service handling last-mile drone delivery handoffs and real-time telemetry tracking.
 */
class DroneService {
  constructor() {
    this.activeMissions = new Map();
  }

  /**
   * Initiates a drone launch for last-mile delivery handoff.
   * @param {Object} params
   * @param {string} params.tripId
   * @param {string} params.parcelId
   * @param {Object} params.safeZoneGps - { lat, lng }
   * @param {Object} params.destinationGps - { lat, lng }
   * @returns {Object} Mission dispatch details
   */
  async launchDroneDelivery({ tripId, parcelId, safeZoneGps, destinationGps }) {
    const droneId = `DRN-AeroX-${Math.floor(10 + Math.random() * 90)}`;
    const missionId = `MSN-${Date.now()}`;

    const missionData = {
      missionId,
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

    this.activeMissions.set(missionId, missionData);
    logger.info(`[DroneService] Launched drone mission ${missionId} with drone ${droneId}`);

    return missionData;
  }

  /**
   * Retrieves real-time telemetry for an active drone mission.
   * @param {string} missionId
   * @returns {Object|null} Telemetry details
   */
  async getDroneTelemetry(missionId) {
    if (!this.activeMissions.has(missionId)) {
      return null;
    }

    const mission = this.activeMissions.get(missionId);
    return {
      ...mission,
      lastTelemetryUpdate: new Date().toISOString()
    };
  }
}

export const droneService = new DroneService();
