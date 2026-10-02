import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PlatooningCoordinatorService,
  calculateOptimalGapFeet,
  calculateFuelSavingsPercent,
  PLATOON_CONFIG,
  PLATOON_STATUS,
  VEHICLE_ROLE,
} from '../../../backend/api/src/services/platooningCoordinatorService.js';

describe('Autonomous Truck Platooning Coordinator Service', () => {
  let coordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = new PlatooningCoordinatorService({
      supabase: {},
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });
  });

  describe('Aerodynamic & Optimal Gap Calculations', () => {
    it('calculates optimal gap in feet dynamically scaling with velocity and weight', () => {
      const gapLowSpeed = calculateOptimalGapFeet(50, 25, 0.8);
      const gapHighSpeed = calculateOptimalGapFeet(70, 35, 0.8);

      expect(gapLowSpeed).toBeGreaterThanOrEqual(PLATOON_CONFIG.MIN_GAP_FEET);
      expect(gapHighSpeed).toBeGreaterThan(gapLowSpeed);
      expect(gapHighSpeed).toBeLessThanOrEqual(PLATOON_CONFIG.MAX_GAP_FEET);
    });

    it('increases following distance gap during low friction / slippery surface conditions', () => {
      const dryGap = calculateOptimalGapFeet(65, 30, 0.8);
      const wetIceGap = calculateOptimalGapFeet(65, 30, 0.4);

      expect(wetIceGap).toBeGreaterThan(dryGap);
    });

    it('returns safe default fallback on invalid inputs', () => {
      expect(calculateOptimalGapFeet(null)).toBe(PLATOON_CONFIG.DEFAULT_OPTIMAL_GAP_FEET);
      expect(calculateOptimalGapFeet(NaN)).toBe(PLATOON_CONFIG.DEFAULT_OPTIMAL_GAP_FEET);
      expect(calculateOptimalGapFeet(-10)).toBe(PLATOON_CONFIG.DEFAULT_OPTIMAL_GAP_FEET);
    });

    it('computes realistic empirical fuel savings for lead and follower vehicles', () => {
      const leadSavings = calculateFuelSavingsPercent(VEHICLE_ROLE.LEAD, 50, 65);
      const followerSavings = calculateFuelSavingsPercent(VEHICLE_ROLE.FOLLOWER, 50, 65);

      expect(leadSavings).toBeGreaterThanOrEqual(2.0);
      expect(leadSavings).toBeLessThan(followerSavings);
      expect(followerSavings).toBeGreaterThanOrEqual(8.0);
      expect(followerSavings).toBeLessThanOrEqual(16.0);
    });
  });

  describe('Platoon Session Lifecycle & Management', () => {
    it('discovers matching platoon partners along a corridor', async () => {
      const partners = await coordinator.findPlatoonPartners({
        truckId: 'TRX-001',
        highwayRoute: 'I-80 Westbound',
        currentSpeedMph: 65,
      });

      expect(Array.isArray(partners)).toBe(true);
      expect(partners.length).toBeGreaterThan(0);
      expect(partners[0].matchId).toBeDefined();
      expect(partners[0].partnerDriverName).toBeDefined();
      expect(partners[0].estimatedFuelSavingsPercent).toBeGreaterThan(0);
    });

    it('creates an active multi-truck platoon session with proper slot roles', () => {
      const session = coordinator.createPlatoonSession({
        leadTruckId: 'TRX-LEAD-1',
        leadDriverName: 'Mohith Reddy',
        followerTruckId: 'TRX-FLW-2',
        followerDriverName: 'Sarah Miller',
        targetSpeedMph: 65.0,
      });

      expect(session.platoonId).toBeDefined();
      expect(session.status).toBe(PLATOON_STATUS.ACTIVE);
      expect(session.members).toHaveLength(2);
      expect(session.members[0].role).toBe(VEHICLE_ROLE.LEAD);
      expect(session.members[1].role).toBe(VEHICLE_ROLE.FOLLOWER);
      expect(session.optimalGapFeet).toBeGreaterThan(0);
    });

    it('processes telemetry updates and accumulates fuel and financial savings', () => {
      const session = coordinator.createPlatoonSession({
        leadTruckId: 'TRX-LEAD-1',
        followerTruckId: 'TRX-FLW-2',
        targetSpeedMph: 65.0,
      });

      const updated = coordinator.processTelemetry(session.platoonId, {
        distanceCoveredMiles: 50.0,
        currentSpeedMph: 65.0,
      });

      expect(updated.totalFuelSavedGallons).toBeGreaterThan(0);
      expect(updated.totalFinancialSavings).toBeGreaterThan(0);
    });

    it('triggers emergency split when deceleration exceeds safety threshold', () => {
      const session = coordinator.createPlatoonSession({
        leadTruckId: 'TRX-LEAD-1',
        followerTruckId: 'TRX-FLW-2',
      });

      const result = coordinator.evaluateSafetyAndDecouple(session.platoonId, {
        accelerationMps2: -6.0, // Hard braking
      });

      expect(result.status).toBe(PLATOON_STATUS.EMERGENCY_SPLIT);
      expect(result.action).toBe('INSTANT_DISENGAGEMENT');
      expect(result.safeSeparationInitiated).toBe(true);
    });

    it('triggers emergency split on manual driver override', () => {
      const session = coordinator.createPlatoonSession({
        leadTruckId: 'TRX-LEAD-1',
        followerTruckId: 'TRX-FLW-2',
      });

      const result = coordinator.evaluateSafetyAndDecouple(session.platoonId, {
        accelerationMps2: 0,
        manualOverride: true,
      });

      expect(result.status).toBe(PLATOON_STATUS.EMERGENCY_SPLIT);
      expect(result.reason).toContain('Manual driver override');
    });

    it('disengages platoon session cleanly and provides summary metrics', () => {
      const session = coordinator.createPlatoonSession({
        leadTruckId: 'TRX-LEAD-1',
        followerTruckId: 'TRX-FLW-2',
      });

      coordinator.processTelemetry(session.platoonId, { distanceCoveredMiles: 20 });
      const summary = coordinator.disengagePlatoon(session.platoonId);

      expect(summary.status).toBe(PLATOON_STATUS.DISENGAGED);
      expect(summary.summary.membersCount).toBe(2);
      expect(summary.summary.totalFuelSavedGallons).toBeGreaterThan(0);
    });
  });
});
