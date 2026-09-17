import { describe, it, expect } from 'vitest';
import { arLoadingOptimizerService } from '../../src/services/arLoadingOptimizerService.js';

describe('arLoadingOptimizerService', () => {
  const defaultContainer = {
    lengthCm: 1615,
    widthCm: 259,
    heightCm: 280,
    maxPayloadKg: 20000
  };

  const samplePallets = [
    { id: 'PLT-1', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 850, fragile: false },
    { id: 'PLT-2', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 950, fragile: true }
  ];

  it('throws an error if container specs are missing or pallets is not an array', async () => {
    await expect(arLoadingOptimizerService.generateLoadingPlan({ container: null, pallets: samplePallets }))
      .rejects.toThrow('Invalid container specs or empty pallets list');

    await expect(arLoadingOptimizerService.generateLoadingPlan({ container: defaultContainer, pallets: [] }))
      .rejects.toThrow('Invalid container specs or empty pallets list');

    await expect(arLoadingOptimizerService.generateLoadingPlan({ container: defaultContainer, pallets: null }))
      .rejects.toThrow('Invalid container specs or empty pallets list');
  });

  it('generates a valid loading plan with placement sequence and axle distribution', async () => {
    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      container: defaultContainer,
      pallets: samplePallets
    });

    expect(plan).toBeDefined();
    expect(plan.planId).toMatch(/^AR-PLAN-\d+$/);
    expect(plan.totalWeightKg).toBe(1800);
    expect(plan.maxPayloadKg).toBe(20000);
    expect(plan.volumeUtilizationPercent).toBeGreaterThan(0);
    expect(plan.payloadCapacityPercent).toBeCloseTo((1800 / 20000) * 100, 1);
    expect(plan.placementSequence).toHaveLength(2);

    const first = plan.placementSequence[0];
    expect(first.stepNumber).toBe(1);
    expect(first.palletId).toBe('PLT-1');
    expect(first.weightKg).toBe(850);
    expect(first.position3D).toEqual({ xCm: 0, yCm: 0, zCm: 0 });
    expect(first.arBoundingBox.min).toEqual([0, 0, 0]);
    expect(first.arBoundingBox.max).toEqual([1.2, 1, 1.5]);

    const second = plan.placementSequence[1];
    expect(second.stepNumber).toBe(2);
    expect(second.palletId).toBe('PLT-2');
    expect(second.position3D.xCm).toBe(120);

    expect(plan.axleDistribution.isDotCompliant).toBe(true);
    expect(plan.axleDistribution.steerAxleKg).toBeGreaterThan(0);
    expect(plan.axleDistribution.driveAxlesKg).toBeGreaterThan(0);
    expect(plan.axleDistribution.trailerAxlesKg).toBeGreaterThan(0);
  });

  it('correctly reports DOT non-compliance when payload exceeds maxPayloadKg', async () => {
    const heavyPallet = [{ id: 'HEAVY-1', lengthCm: 120, widthCm: 100, heightCm: 150, weightKg: 25000 }];
    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      container: defaultContainer,
      pallets: heavyPallet
    });

    expect(plan.totalWeightKg).toBe(25000);
    expect(plan.axleDistribution.isDotCompliant).toBe(false);
  });

  it('retrieves an existing loading plan by ID', async () => {
    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      container: defaultContainer,
      pallets: samplePallets
    });

    const retrieved = await arLoadingOptimizerService.getLoadingPlan(plan.planId);
    expect(retrieved).toEqual(plan);
  });

  it('returns null when retrieving a non-existent plan ID', async () => {
    const retrieved = await arLoadingOptimizerService.getLoadingPlan('NON-EXISTENT-ID');
    expect(retrieved).toBeNull();
  });
});
