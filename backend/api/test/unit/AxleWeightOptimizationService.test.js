import { describe, it, expect } from 'vitest';
import {
  calculateAxleWeightDistribution,
  pack3dLifoCargo,
  calculateConsolidationYield,
  AxleWeightOptimizationService,
  defaultAxleWeightService,
  CMVR_AXLE_LIMITS_KG,
  CMVR_SAFETY_THRESHOLDS,
  DEFAULT_TRUCK_SPEC,
} from '../../src/services/consolidation/AxleWeightOptimizationService.js';
import { matchLtlPartialLoads } from '../../src/services/ltlConsolidation.js';

describe('CMVR Axle Weight Statics & Beam-Moment Mechanics', () => {
  const truckSpec = {
    wheelbaseLengthMeters: 6.0,
    bogieDistanceMeters: 6.0,
    tareSteerWeightKg: 3500,
    tareBogieWeightKg: 4500,
    steerAxleLimitKg: 6500,
    bogieAxleLimitKg: 19000,
  };

  it('calculates unladen tare distribution correctly with no cargo', () => {
    const result = calculateAxleWeightDistribution(truckSpec, []);
    expect(result.compliant).toBe(true);
    expect(result.grossVehicleWeightKg).toBe(8000);
    expect(result.steerAxle.weightKg).toBe(3500);
    expect(result.bogieAxle.weightKg).toBe(4500);
    expect(result.violations).toHaveLength(0);
  });

  it('accurately divides load when cargo is centered exactly at midpoint (x = L/2)', () => {
    // 6,000 kg placed at x = 3.0m on a 6.0m wheelbase -> 50% to steer (3,000 kg), 50% to bogie (3,000 kg)
    const cargo = [{ weightKg: 6000, xPositionMeters: 3.0 }];
    const result = calculateAxleWeightDistribution(truckSpec, cargo);

    expect(result.grossVehicleWeightKg).toBe(14000);
    expect(result.totalCargoWeightKg).toBe(6000);
    expect(result.steerAxle.weightKg).toBe(6500); // 3500 + 3000 = 6500 kg
    expect(result.bogieAxle.weightKg).toBe(7500); // 4500 + 3000 = 7500 kg
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects statutory CMVR steer axle overload when cargo is concentrated forward', () => {
    // 5,000 kg placed near front bulkhead at x = 1.0m (wheelbase = 6m)
    // Steer moment share = (6 - 1) / 6 * 5000 = 5/6 * 5000 = 4166.7 kg
    // Total steer = 3500 + 4166.7 = 7666.7 kg (> 6500 kg limit!)
    const cargo = [{ weightKg: 5000, xPositionMeters: 1.0 }];
    const result = calculateAxleWeightDistribution(truckSpec, cargo);

    expect(result.compliant).toBe(false);
    expect(result.steleAxleOverload || result.steerAxle.isOverloaded).toBe(true);
    expect(result.steerAxle.weightKg).toBeGreaterThan(6500);
    expect(result.violations.some(v => v.code === 'CMVR_STEER_AXLE_OVERLOAD')).toBe(true);
  });

  it('detects statutory CMVR tandem bogie overload when heavy cargo is concentrated rearward', () => {
    // 16,000 kg placed near rear bogie at x = 5.5m (wheelbase = 6m)
    // Bogie moment share = 5.5 / 6 * 16000 = 14666.7 kg
    // Total bogie = 4500 + 14666.7 = 19166.7 kg (> 19000 kg limit!)
    const cargo = [{ weightKg: 16000, xPositionMeters: 5.5 }];
    const result = calculateAxleWeightDistribution(truckSpec, cargo);

    expect(result.compliant).toBe(false);
    expect(result.bogieAxle.isOverloaded).toBe(true);
    expect(result.bogieAxle.weightKg).toBeGreaterThan(19000);
    expect(result.violations.some(v => v.code === 'CMVR_BOGIE_AXLE_OVERLOAD')).toBe(true);
  });

  it('detects steer axle underload and steering traction loss when cargo is placed in rear overhang', () => {
    // Rear overhang: cargo placed at x = 7.5m (beyond bogie at 6.0m)
    // Cantilever moment: (6.0 - 7.5) / 6.0 * 8000 = -1.5 / 6.0 * 8000 = -2000 kg lifted off steer axle!
    // Total steer = 3500 - 2000 = 1500 kg.
    // Gross weight = 3500 + 4500 + 8000 = 16000 kg.
    // Steer ratio = 1500 / 16000 = 9.375% (< 20% statutory threshold!)
    const cargo = [{ weightKg: 8000, xPositionMeters: 7.5 }];
    const result = calculateAxleWeightDistribution(truckSpec, cargo);

    expect(result.compliant).toBe(false);
    expect(result.steerAxle.isUnderloaded).toBe(true);
    expect(result.steerAxle.ratioOfGvw).toBeLessThan(20.0);
    expect(result.violations.some(v => v.code === 'CMVR_STEER_AXLE_UNDERLOAD_TRACTION_LOSS')).toBe(true);
  });

  it('accurately derives the longitudinal Center of Gravity (CoG)', () => {
    const cargo = [
      { weightKg: 2000, xPositionMeters: 2.0 },
      { weightKg: 4000, xPositionMeters: 5.0 },
    ];
    const result = calculateAxleWeightDistribution(truckSpec, cargo);

    // Total weight = 3500 (front at 0) + 4500 (bogie at 6) + 2000 (at 2) + 4000 (at 5) = 14000 kg
    // Total moment = (4500 * 6) + (2000 * 2) + (4000 * 5) = 27000 + 4000 + 20000 = 51000 kg*m
    // CoG = 51000 / 14000 ≈ 3.643 m
    expect(result.centerOfGravity.longitudinalMeters).toBeCloseTo(3.643, 2);
    expect(result.centerOfGravity.relativeToBogieMeters).toBeCloseTo(6.0 - 3.643, 2);
  });
});

describe('3D Combinatorial Bin Packing & Topological LIFO Drop Sequencing', () => {
  const trailerSpec = {
    lengthMeters: 8.0,
    widthMeters: 2.4,
    heightMeters: 2.4,
  };

  it('packs multiple multi-stop cargo items within 3D trailer boundaries without collision', () => {
    const items = [
      { id: 'BOX-STOP-3', lengthMeters: 2.0, widthMeters: 2.0, heightMeters: 1.0, weightKg: 1500, dropStopSequence: 3 },
      { id: 'BOX-STOP-2', lengthMeters: 2.0, widthMeters: 2.0, heightMeters: 1.0, weightKg: 1200, dropStopSequence: 2 },
      { id: 'BOX-STOP-1', lengthMeters: 2.0, widthMeters: 2.0, heightMeters: 1.0, weightKg: 1000, dropStopSequence: 1 },
    ];

    const result = pack3dLifoCargo(trailerSpec, items);

    expect(result.success).toBe(true);
    expect(result.packedCount).toBe(3);
    expect(result.unpackedCount).toBe(0);
    expect(result.lifoCompliant).toBe(true);
    expect(result.volumetricUtilizationPercentage).toBeGreaterThan(15);

    // Verify non-collision
    for (let i = 0; i < result.packedItems.length; i++) {
      for (let j = i + 1; j < result.packedItems.length; j++) {
        const a = result.packedItems[i];
        const b = result.packedItems[j];
        const noOverlap = (
          a.position.xMeters + a.dimensions.lengthMeters <= b.position.xMeters ||
          b.position.xMeters + b.dimensions.lengthMeters <= a.position.xMeters ||
          a.position.yMeters + a.dimensions.widthMeters <= b.position.yMeters ||
          b.position.yMeters + b.dimensions.widthMeters <= a.position.yMeters ||
          a.position.zMeters + a.dimensions.heightMeters <= b.position.zMeters ||
          b.position.zMeters + b.dimensions.heightMeters <= a.position.zMeters
        );
        expect(noOverlap).toBe(true);
      }
    }
  });

  it('enforces topological LIFO drop sequencing (earliest stop closest to rear doors)', () => {
    // Delivery sequence: Stop 1 delivered first, Stop 2 delivered second.
    // In a rear-door trailer (door at x = L), Stop 2 must be loaded first towards bulkhead (x=0),
    // and Stop 1 must be placed towards the rear door (higher x).
    const items = [
      { id: 'PALLET-STOP-2', lengthMeters: 2.5, widthMeters: 2.0, heightMeters: 1.5, weightKg: 2000, dropStopSequence: 2 },
      { id: 'PALLET-STOP-1', lengthMeters: 2.5, widthMeters: 2.0, heightMeters: 1.5, weightKg: 1800, dropStopSequence: 1 },
    ];

    const result = pack3dLifoCargo(trailerSpec, items);

    expect(result.success).toBe(true);
    const stop1 = result.packedItems.find(p => p.id === 'PALLET-STOP-1');
    const stop2 = result.packedItems.find(p => p.id === 'PALLET-STOP-2');

    // Stop 1 must be positioned at higher x than Stop 2 so it can be extracted first
    expect(stop1.position.xMeters).toBeGreaterThanOrEqual(stop2.position.xMeters + stop2.dimensions.lengthMeters);
  });

  it('rotates items horizontally when allowed to fit trailer dimensions', () => {
    // Item length is 2.3m, width is 1.2m. Fits both ways in a 2.4m wide trailer.
    const items = [
      { id: 'ITEM-ROTATE', lengthMeters: 2.3, widthMeters: 1.2, heightMeters: 1.0, allowRotation: true },
    ];

    const result = pack3dLifoCargo(trailerSpec, items);
    expect(result.packedCount).toBe(1);
    expect(result.packedItems[0].dimensions.lengthMeters).toBeLessThanOrEqual(trailerSpec.lengthMeters);
  });
});

describe('Non-Linear Diesel Consumption & Yield Economics', () => {
  it('models progressive fuel consumption scaling non-linearly with payload ratio', () => {
    const emptyYield = calculateConsolidationYield({
      grossVehicleWeightKg: 8000, // Empty truck
      maxGvwKg: 49000,
      distanceKm: 400,
      totalRevenue: 0,
    });

    const halfLoadedYield = calculateConsolidationYield({
      grossVehicleWeightKg: 25000,
      maxGvwKg: 49000,
      distanceKm: 400,
      totalRevenue: 0,
    });

    const fullLoadedYield = calculateConsolidationYield({
      grossVehicleWeightKg: 45000,
      maxGvwKg: 49000,
      distanceKm: 400,
      totalRevenue: 0,
    });

    expect(emptyYield.consumptionRateLPer100Km).toBeLessThan(halfLoadedYield.consumptionRateLPer100Km);
    expect(halfLoadedYield.consumptionRateLPer100Km).toBeLessThan(fullLoadedYield.consumptionRateLPer100Km);
    expect(fullLoadedYield.totalFuelCost).toBeGreaterThan(halfLoadedYield.totalFuelCost);
  });

  it('deducts detour costs and computes net profit margin', () => {
    const yieldResult = calculateConsolidationYield({
      grossVehicleWeightKg: 20000,
      maxGvwKg: 40000,
      distanceKm: 300,
      detourMinutes: 60, // 1 hour detour @ 250/hr
      totalRevenue: 35000, // 35,000 INR
      fuelPricePerLiter: 90,
    });

    expect(yieldResult.detourCost).toBe(250.0);
    expect(yieldResult.totalFuelCost).toBeGreaterThan(0);
    expect(yieldResult.netYield).toBe(yieldResult.totalRevenue - yieldResult.totalFuelCost - yieldResult.detourCost);
    expect(yieldResult.isProfitable).toBe(true);
    expect(yieldResult.profitMarginPercentage).toBeGreaterThan(50);
  });
});

describe('AxleWeightOptimizationService - Full-Stack Orchestration', () => {
  const service = new AxleWeightOptimizationService();

  const truck = {
    id: 'TRUCK-MH-04-1029',
    routeDistanceKm: 600,
    truckSpec: {
      wheelbaseLengthMeters: 6.5,
      bogieDistanceMeters: 6.5,
      tareSteerWeightKg: 3400,
      tareBogieWeightKg: 4200,
      steerAxleLimitKg: 6500,
      bogieAxleLimitKg: 19000,
    },
    trailerSpec: {
      lengthMeters: 9.0,
      widthMeters: 2.4,
      heightMeters: 2.5,
    },
  };

  it('approves a balanced, LIFO-compliant, profitable multi-stop consolidation', () => {
    const candidateLoads = [
      {
        id: 'CONSOL-DROP-2',
        lengthMeters: 3.0,
        widthMeters: 2.0,
        heightMeters: 1.5,
        weightKg: 2500,
        dropStopSequence: 2,
        payoutINR: 60000,
        estimatedDetourMinutes: 30,
      },
      {
        id: 'CONSOL-DROP-1',
        lengthMeters: 3.0,
        widthMeters: 2.0,
        heightMeters: 1.5,
        weightKg: 3000,
        dropStopSequence: 1,
        payoutINR: 50000,
        estimatedDetourMinutes: 20,
      },
    ];

    const result = service.optimizeConsolidation(truck, candidateLoads);

    expect(result.approved).toBe(true);
    expect(result.packing.success).toBe(true);
    expect(result.packing.lifoCompliant).toBe(true);
    expect(result.axleStatics.compliant).toBe(true);
    expect(result.economics.isProfitable).toBe(true);
    expect(result.rejectionReasons).toHaveLength(0);
  });

  it('rejects consolidation plan that exceeds statutory CMVR steer axle limit', () => {
    // Extreme front load causing severe steer overload
    const overloadedLoads = [
      {
        id: 'CONSOL-HEAVY-FRONT',
        lengthMeters: 2.0,
        widthMeters: 2.0,
        heightMeters: 1.5,
        weightKg: 6000,
        dropStopSequence: 1,
        payoutINR: 10000,
        estimatedDetourMinutes: 0,
      },
    ];

    // Modify truck spec with a tight steer limit to trigger violation
    const strictTruck = {
      ...truck,
      truckSpec: {
        ...truck.truckSpec,
        steerAxleLimitKg: 4500, // Very low limit to force violation
      },
    };

    const result = service.optimizeConsolidation(strictTruck, overloadedLoads);
    expect(result.approved).toBe(false);
    expect(result.rejectionReasons.some(r => r.includes('CMVR'))).toBe(true);
  });
});

describe('matchLtlPartialLoads - CMVR Integration & Backward Compatibility', () => {
  const baseTruck = {
    id: 'TRUCK-LEGACY-01',
    remainingLinearFeet: 24,
    remainingWeightLbs: 18000,
    maxDelayMinutesTolerance: 45,
  };

  it('retains 100% backward compatibility for standard scalar matching', () => {
    const candidateLoads = [
      { id: 'L-1', requiredLinearFeet: 10, requiredWeightLbs: 6000, payoutUSD: 500, estimatedDetourMinutes: 10 },
      { id: 'L-2', requiredLinearFeet: 12, requiredWeightLbs: 8000, payoutUSD: 700, estimatedDetourMinutes: 20 },
    ];

    const result = matchLtlPartialLoads(baseTruck, candidateLoads);
    expect(result.matchedCount).toBe(2);
    expect(result.matches[0].loadId).toBe('L-2');
    expect(result.matches[1].loadId).toBe('L-1');
  });

  it('filters out candidate loads that violate statutory CMVR axle boundaries when enforceCmvrLimits is enabled', () => {
    const candidateLoads = [
      {
        id: 'LOAD-OK',
        requiredLinearFeet: 10,
        requiredWeightLbs: 4000,
        requiredWeightKg: 1800,
        xPositionMeters: 3.0,
        payoutUSD: 400,
      },
      {
        id: 'LOAD-OVERLOAD-STEER',
        requiredLinearFeet: 10,
        requiredWeightLbs: 10000,
        requiredWeightKg: 4500,
        xPositionMeters: 0.2, // Concentrated right over front axle
        payoutUSD: 800,
      },
    ];

    const enhancedTruck = {
      ...baseTruck,
      enforceCmvrLimits: true,
      truckSpec: {
        wheelbaseLengthMeters: 6.0,
        bogieDistanceMeters: 6.0,
        tareSteerWeightKg: 4000,
        steerAxleLimitKg: 6500,
      },
    };

    const result = matchLtlPartialLoads(enhancedTruck, candidateLoads);
    // LOAD-OVERLOAD-STEER produces steer weight 4000 + (6-0.2)/6 * 4500 = 4000 + 4350 = 8350 kg > 6500 kg
    expect(result.matches.some(m => m.loadId === 'LOAD-OK')).toBe(true);
    expect(result.matches.some(m => m.loadId === 'LOAD-OVERLOAD-STEER')).toBe(false);
  });
});
