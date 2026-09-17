import { describe, it, expect, beforeEach } from 'vitest';
import { droneService } from '../../src/services/droneService.js';

describe('droneService', () => {
  beforeEach(() => {
    droneService.activeMissions.clear();
  });

  describe('launchDroneDelivery', () => {
    it('initializes and dispatches a new drone mission with telemetry metadata', async () => {
      const launchParams = {
        ownerId: 'user-101',
        tripId: 'TRIP-DRN-101',
        parcelId: 'PARCEL-MED-44',
        safeZoneGps: { lat: 39.7392, lng: -104.9903 },
        destinationGps: { lat: 39.7555, lng: -104.9821 },
      };

      const mission = await droneService.launchDroneDelivery(launchParams);

      expect(mission.missionId).toMatch(/^MSN-\d+$/);
      expect(mission.droneId).toMatch(/^DRN-AeroX-\d+$/);
      expect(mission.tripId).toBe('TRIP-DRN-101');
      expect(mission.parcelId).toBe('PARCEL-MED-44');
      expect(mission.status).toBe('DISPATCHED');
      expect(mission.safeZoneGps).toEqual(launchParams.safeZoneGps);
      expect(mission.destinationGps).toEqual(launchParams.destinationGps);
      expect(mission.batteryPercent).toBe(100);
      expect(mission.distanceToDestinationKm).toBe(2.5);
      expect(mission.estimatedArrivalMinutes).toBe(5);
      expect(mission.createdAt).toBeDefined();

      expect(droneService.activeMissions.has(mission.missionId)).toBe(true);
    });
  });

  describe('getDroneTelemetry', () => {
    it('retrieves telemetry with updated timestamp for an active mission', async () => {
      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-202',
        tripId: 'TRIP-DRN-202',
        parcelId: 'PARCEL-URGENT-88',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });

      const telemetry = await droneService.getDroneTelemetry(mission.missionId);

      expect(telemetry).not.toBeNull();
      expect(telemetry.missionId).toBe(mission.missionId);
      expect(telemetry.droneId).toBe(mission.droneId);
      expect(telemetry.lastTelemetryUpdate).toBeDefined();
    });

    it('does not return telemetry to a different owner', async () => {
      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-owner',
        tripId: 'TRIP-DRN-203',
        parcelId: 'PARCEL-203',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });

      await expect(droneService.getDroneTelemetry(mission.missionId, 'user-other')).resolves.toBeNull();
      await expect(droneService.getDroneTelemetry(mission.missionId, 'user-owner')).resolves.toMatchObject({
        missionId: mission.missionId,
      });
    });

    it('returns null for an unknown or nonexistent mission ID', async () => {
      const telemetry = await droneService.getDroneTelemetry('MSN-NONEXISTENT');
      expect(telemetry).toBeNull();
    });
  });
});
