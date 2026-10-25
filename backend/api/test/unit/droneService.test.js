import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  droneService,
  MAX_ACTIVE_DRONE_MISSIONS,
  TERMINAL_MISSION_RETENTION_MS,
  STALE_MISSION_TTL_MS,
} from '../../src/services/droneService.js';

describe('droneService', () => {
  beforeEach(() => {
    droneService.clearMissions();
  });

  afterEach(() => {
    vi.useRealTimers();
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

      expect(mission.missionId).toMatch(/^MSN-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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

  describe('abortMission', () => {
    it('persists the abort state for subsequent telemetry reads', async () => {
      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-abort',
        tripId: 'TRIP-DRN-ABORT',
        parcelId: 'PARCEL-ABORT',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });

      const aborted = await droneService.abortMission(mission.missionId, 'user-abort');
      expect(aborted.status).toBe('ABORTED_RETURNING_TO_BASE');
      expect(aborted.abortedAt).toBeDefined();

      const telemetry = await droneService.getDroneTelemetry(mission.missionId, 'user-abort');
      expect(telemetry.status).toBe('ABORTED_RETURNING_TO_BASE');
      expect(telemetry.abortedAt).toBe(aborted.abortedAt);
    });

    it('does not abort a mission owned by another user', async () => {
      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-owner',
        tripId: 'TRIP-DRN-OWNER',
        parcelId: 'PARCEL-OWNER',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });

      await expect(droneService.abortMission(mission.missionId, 'user-other')).resolves.toBeNull();
      await expect(droneService.getDroneTelemetry(mission.missionId, 'user-owner')).resolves.toMatchObject({
        status: 'DISPATCHED',
      });
    });
  });

  describe('mission retention', () => {
    it('expires terminal missions after the retention window', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-terminal',
        tripId: 'TRIP-DRN-TERMINAL',
        parcelId: 'PARCEL-TERMINAL',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });
      await droneService.abortMission(mission.missionId, 'user-terminal');

      vi.setSystemTime(new Date(Date.now() + TERMINAL_MISSION_RETENTION_MS + 1));

      await expect(droneService.getDroneTelemetry(mission.missionId, 'user-terminal')).resolves.toBeNull();
      expect(droneService.getMissionCount()).toBe(0);
    });

    it('expires stale active missions after the stale TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const mission = await droneService.launchDroneDelivery({
        ownerId: 'user-stale',
        tripId: 'TRIP-DRN-STALE',
        parcelId: 'PARCEL-STALE',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      });

      vi.setSystemTime(new Date(Date.now() + STALE_MISSION_TTL_MS + 1));

      await expect(droneService.getDroneTelemetry(mission.missionId, 'user-stale')).resolves.toBeNull();
      expect(droneService.getMissionCount()).toBe(0);
    });

    it('caps active missions and rejects launches at capacity', async () => {
      for (let index = 0; index < MAX_ACTIVE_DRONE_MISSIONS; index += 1) {
        await droneService.launchDroneDelivery({
          ownerId: `owner-${index}`,
          tripId: `TRIP-${index}`,
          parcelId: `PARCEL-${index}`,
          safeZoneGps: { lat: 40.7128, lng: -74.006 },
          destinationGps: { lat: 40.7306, lng: -73.9352 },
        });
      }

      expect(droneService.getMissionCount()).toBe(MAX_ACTIVE_DRONE_MISSIONS);
      await expect(droneService.launchDroneDelivery({
        ownerId: 'owner-overflow',
        tripId: 'TRIP-OVERFLOW',
        parcelId: 'PARCEL-OVERFLOW',
        safeZoneGps: { lat: 40.7128, lng: -74.006 },
        destinationGps: { lat: 40.7306, lng: -73.9352 },
      })).rejects.toMatchObject({ statusCode: 429 });
    });
  });
});
