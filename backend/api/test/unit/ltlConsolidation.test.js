import { describe, it, expect } from 'vitest';
import { matchLtlPartialLoads } from '../../src/services/ltlConsolidation.js';

describe('ltlConsolidation service', () => {
  const baseTruck = {
    id: 'TRUCK-LTL-01',
    remainingLinearFeet: 24,
    remainingWeightLbs: 18000,
    maxDelayMinutesTolerance: 45,
  };

  it('filters and ranks compatible candidate loads by net incremental payout', () => {
    const partialLoads = [
      {
        id: 'LOAD-A',
        origin: 'Dallas, TX',
        destination: 'Oklahoma City, OK',
        requiredLinearFeet: 10,
        requiredWeightLbs: 6000,
        estimatedDetourMinutes: 20,
        payoutUSD: 450,
      },
      {
        id: 'LOAD-B',
        origin: 'Fort Worth, TX',
        destination: 'Tulsa, OK',
        requiredLinearFeet: 12,
        requiredWeightLbs: 8000,
        estimatedDetourMinutes: 30,
        payoutUSD: 700,
      },
      {
        id: 'LOAD-C',
        origin: 'Waco, TX',
        destination: 'Norman, OK',
        requiredLinearFeet: 8,
        requiredWeightLbs: 4000,
        estimatedDetourMinutes: 15,
        payoutUSD: 300,
      },
    ];

    const result = matchLtlPartialLoads(baseTruck, partialLoads);

    expect(result.truckId).toBe('TRUCK-LTL-01');
    expect(result.availableCapacity.remainingLinearFeet).toBe(24);
    expect(result.availableCapacity.remainingWeightLbs).toBe(18000);
    expect(result.matchedCount).toBe(3);

    // LOAD-B net payout = 700 - (30/60 * 35) = 700 - 17.5 = 682.5
    // LOAD-A net payout = 450 - (20/60 * 35) = 450 - 11.67 = 438.33
    // LOAD-C net payout = 300 - (15/60 * 35) = 300 - 8.75 = 291.25
    expect(result.matches[0].loadId).toBe('LOAD-B');
    expect(result.matches[0].netIncrementalPayoutUSD).toBe(682.5);
    expect(result.matches[1].loadId).toBe('LOAD-A');
    expect(result.matches[1].netIncrementalPayoutUSD).toBe(438.33);
    expect(result.matches[2].loadId).toBe('LOAD-C');
    expect(result.matches[2].netIncrementalPayoutUSD).toBe(291.25);
  });

  it('excludes loads that exceed linear feet trailer capacity', () => {
    const partialLoads = [
      {
        id: 'LOAD-TOO-LONG',
        requiredLinearFeet: 28, // Exceeds 24 ft
        requiredWeightLbs: 5000,
        estimatedDetourMinutes: 10,
        payoutUSD: 900,
      },
    ];

    const result = matchLtlPartialLoads(baseTruck, partialLoads);
    expect(result.matchedCount).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it('excludes loads that exceed remaining weight capacity', () => {
    const partialLoads = [
      {
        id: 'LOAD-TOO-HEAVY',
        requiredLinearFeet: 10,
        requiredWeightLbs: 25000, // Exceeds 18000 lbs
        estimatedDetourMinutes: 10,
        payoutUSD: 1200,
      },
    ];

    const result = matchLtlPartialLoads(baseTruck, partialLoads);
    expect(result.matchedCount).toBe(0);
  });

  it('excludes loads that exceed detour time tolerance', () => {
    const partialLoads = [
      {
        id: 'LOAD-EXCESSIVE-DETOUR',
        requiredLinearFeet: 10,
        requiredWeightLbs: 5000,
        estimatedDetourMinutes: 90, // Exceeds 45 min tolerance
        payoutUSD: 1000,
      },
    ];

    const result = matchLtlPartialLoads(baseTruck, partialLoads);
    expect(result.matchedCount).toBe(0);
  });

  it('computes linear foot and weight utilization percentage metrics', () => {
    const partialLoads = [
      {
        id: 'LOAD-METRICS',
        requiredLinearFeet: 12, // 12/24 = 50%
        requiredWeightLbs: 9000, // 9000/18000 = 50%
        estimatedDetourMinutes: 0,
        payoutUSD: 500,
      },
    ];

    const result = matchLtlPartialLoads(baseTruck, partialLoads);
    expect(result.matches[0].spaceUtilizationImpact.linearFootPercentage).toBe(50.0);
    expect(result.matches[0].spaceUtilizationImpact.weightPercentage).toBe(50.0);
  });

  it('handles empty candidates list and default truck constraints', () => {
    const result = matchLtlPartialLoads({ id: 'EMPTY-TRUCK' }, []);
    expect(result.matchedCount).toBe(0);
    expect(result.availableCapacity.remainingLinearFeet).toBe(0);
    expect(result.availableCapacity.remainingWeightLbs).toBe(0);
  });
});
