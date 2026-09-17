import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { determineOptimalEcmProfile, generateOtaTuningPayload } from '../../src/services/ecmTuning.js';

describe('ecmTuning service', () => {
  describe('determineOptimalEcmProfile', () => {
    it('selects MOUNTAIN_POWER when gradient is >= 3.5%', () => {
      const profile = determineOptimalEcmProfile({ averageGradientPercent: 4.2 });
      expect(profile.profileId).toBe('PROFILE_MOUNTAIN_POWER_v3.1');
      expect(profile.mode).toBe('STEEP_CLIMB_PERFORMANCE');
      expect(profile.maxTorqueNm).toBe(2500);
      expect(profile.engineBrakingLevel).toBe('HIGH');
    });

    it('selects MOUNTAIN_POWER when upcomingTerrain is MOUNTAIN_CLIMB', () => {
      const profile = determineOptimalEcmProfile({
        averageGradientPercent: 1.0,
        upcomingTerrain: 'mountain_climb',
      });
      expect(profile.profileId).toBe('PROFILE_MOUNTAIN_POWER_v3.1');
    });

    it('selects DESCENT_REGEN when gradient is <= -3.0%', () => {
      const profile = determineOptimalEcmProfile({ averageGradientPercent: -3.5 });
      expect(profile.profileId).toBe('PROFILE_DESCENT_REGEN_v1.8');
      expect(profile.mode).toBe('DOWNGRADIENT_RETARDER');
      expect(profile.engineBrakingLevel).toBe('MAXIMUM');
    });

    it('selects DESCENT_REGEN when upcomingTerrain is MOUNTAIN_DESCENT', () => {
      const profile = determineOptimalEcmProfile({
        averageGradientPercent: 0,
        upcomingTerrain: 'mountain_descent',
      });
      expect(profile.profileId).toBe('PROFILE_DESCENT_REGEN_v1.8');
    });

    it('defaults to ECO_FLAT for normal highway conditions', () => {
      const profile = determineOptimalEcmProfile({
        averageGradientPercent: 0.5,
        upcomingTerrain: 'flat',
      });
      expect(profile.profileId).toBe('PROFILE_ECO_FLAT_v2.4');
      expect(profile.mode).toBe('FLAT_HIGHWAY_ECO');
      expect(profile.fuelEfficiencyBias).toBe('MAXIMUM_ECONOMY');
      expect(profile.engineBrakingLevel).toBe('LOW');
    });

    it('handles empty topology data with default ECO_FLAT', () => {
      const profile = determineOptimalEcmProfile({});
      expect(profile.profileId).toBe('PROFILE_ECO_FLAT_v2.4');
    });
  });

  describe('generateOtaTuningPayload', () => {
    it('generates a cryptographically signed OTA update package', () => {
      const tuningParams = {
        truckId: 'TRUCK-9901',
        vin: '1HD1KMM129K912831',
        topologyData: { averageGradientPercent: 5.0 },
      };

      const result = generateOtaTuningPayload(tuningParams);

      expect(result.status).toBe('READY_FOR_TRANSMISSION');
      expect(result.otaPackage.truckId).toBe('TRUCK-9901');
      expect(result.otaPackage.vin).toBe('1HD1KMM129K912831');
      expect(result.otaPackage.targetProfile.profileId).toBe('PROFILE_MOUNTAIN_POWER_v3.1');
      expect(result.otaPackage.validityWindowSeconds).toBe(3600);
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/);

      // Verify HMAC signature authenticity
      const secret = process.env.ECM_OTA_SIGNING_KEY || 'ecm-ota-secure-key';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(result.otaPackage))
        .digest('hex');

      expect(result.signature).toBe(expected);
    });

    it('provides fallback values when optional parameters are omitted', () => {
      const result = generateOtaTuningPayload({ truckId: 'TRUCK-ONLY' });

      expect(result.otaPackage.vin).toBe('UNKNOWN_VIN');
      expect(result.otaPackage.targetProfile.profileId).toBe('PROFILE_ECO_FLAT_v2.4');
      expect(result.signature).toBeDefined();
    });
  });
});
