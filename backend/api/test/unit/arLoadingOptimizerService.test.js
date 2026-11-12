import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  arLoadingOptimizerService,
  MAX_RETAINED_LOADING_PLANS,
} from '../../src/services/arLoadingOptimizerService.js';

describe('arLoadingOptimizerService', () => {
  beforeEach(() => {
    arLoadingOptimizerService.clearLoadingPlans();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(plan.planId).toMatch(/^PLAN-[0-9a-f-]{36}$/);
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

  it('does not return a plan to a different owner', async () => {
    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      ownerId: 'owner-a',
      container: defaultContainer,
      pallets: samplePallets,
    });

    await expect(arLoadingOptimizerService.getLoadingPlan(plan.planId, 'owner-b')).resolves.toBeNull();
    await expect(arLoadingOptimizerService.getLoadingPlan(plan.planId, 'owner-a')).resolves.toMatchObject({
      planId: plan.planId,
      ownerId: 'owner-a',
    });
  });

  it('expires loading plans after the retention window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const plan = await arLoadingOptimizerService.generateLoadingPlan({
      ownerId: 'owner-expiry',
      container: defaultContainer,
      pallets: samplePallets,
    });

    expect(arLoadingOptimizerService.getLoadingPlanCount()).toBe(1);

    vi.setSystemTime(new Date('2026-01-01T01:00:00.001Z'));

    await expect(arLoadingOptimizerService.getLoadingPlan(plan.planId, 'owner-expiry')).resolves.toBeNull();
    expect(arLoadingOptimizerService.getLoadingPlanCount()).toBe(0);
  });

  it('rejects new plans once the registry reaches capacity', async () => {
    for (let index = 0; index < MAX_RETAINED_LOADING_PLANS; index += 1) {
      await arLoadingOptimizerService.generateLoadingPlan({
        ownerId: `owner-${index}`,
        container: defaultContainer,
        pallets: samplePallets,
      });
    }

    expect(arLoadingOptimizerService.getLoadingPlanCount()).toBe(MAX_RETAINED_LOADING_PLANS);
    await expect(arLoadingOptimizerService.generateLoadingPlan({
      ownerId: 'owner-overflow',
      container: defaultContainer,
      pallets: samplePallets,
    })).rejects.toMatchObject({ statusCode: 429 });
  });
});
