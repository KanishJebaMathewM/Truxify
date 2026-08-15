import { describe, it, expect } from 'vitest';
import {
  calculateRouteOperatingCost,
  optimizeTollRoutes,
} from '../../src/services/tollOptimization.js';

// Regression for #14823: tollOptimization.js previously used Python-style `#`
// line comments inside the DEFAULT_CONFIG object literal, which made the
// module fail to parse (`SyntaxError: Invalid or unexpected token`) and
// therefore impossible to import. These tests exercise the two exported
// functions; simply importing the module would have thrown before the fix.

describe('tollOptimization service module loads (#14823)', () => {
  it('imports without a SyntaxError and exposes both functions', () => {
    expect(typeof calculateRouteOperatingCost).toBe('function');
    expect(typeof optimizeTollRoutes).toBe('function');
  });
});

describe('calculateRouteOperatingCost', () => {
  it('computes fuel + time + toll and rounds each component to 2 decimals', () => {
    const result = calculateRouteOperatingCost({
      distanceMiles: 650,
      estimatedTimeHours: 10,
      tollCostUSD: 50,
    });

    // Defaults: $4.10/gal, 6.5 mpg, $30/hr driver.
    // fuel = 650 / 6.5 * 4.10 = 410.00 ; time = 10 * 30 = 300.00 ; toll = 50.00
    expect(result.fuelGallonsUsed).toBe(100);
    expect(result.fuelCostUSD).toBe(410);
    expect(result.timeCostUSD).toBe(300);
    expect(result.tollCostUSD).toBe(50);
    expect(result.totalCostUSD).toBe(760);
  });

  it('accepts caller-supplied fuel price, mpg, and driver rate', () => {
    const result = calculateRouteOperatingCost({
      distanceMiles: 100,
      estimatedTimeHours: 2,
      tollCostUSD: 0,
      fuelPrice: 5.0,
      mpg: 10,
      driverHourlyRate: 25,
    });

    // fuel = 100 / 10 * 5 = 50 ; time = 2 * 25 = 50 ; toll = 0
    expect(result.fuelCostUSD).toBe(50);
    expect(result.timeCostUSD).toBe(50);
    expect(result.totalCostUSD).toBe(100);
  });

  it('defaults tollCostUSD to 0 when omitted', () => {
    const result = calculateRouteOperatingCost({
      distanceMiles: 0,
      estimatedTimeHours: 0,
    });
    expect(result.tollCostUSD).toBe(0);
    expect(result.totalCostUSD).toBe(0);
  });
});

describe('optimizeTollRoutes', () => {
  const routes = [
    { id: 'toll-route', name: 'Toll Route', distanceMiles: 600, estimatedTimeHours: 10, baseTollUSD: 40 },
    { id: 'free-route', name: 'Free Route', distanceMiles: 700, estimatedTimeHours: 9, baseTollUSD: 0 },
  ];

  it('recommends the lowest total cost route and ranks all candidates', () => {
    const result = optimizeTollRoutes(routes, { grossPayoutUSD: 1500, axleCount: 5 });

    // 5-axle => axleMultiplier 2.5 ; commercial toll for toll-route = 40 * 2.5 = 100
    // toll-route total = 600/6.5*4.1 + 10*30 + 100 = 378.46.. + 300 + 100 = 778.46..
    // free-route total = 700/6.5*4.1 + 9*30 + 0 = 441.54.. + 270 + 0 = 711.54..
    // => free-route is cheaper
    expect(result.recommendedRoute.routeId).toBe('free-route');
    expect(result.allCandidateRoutes).toHaveLength(2);
    // sorted ascending by total cost
    expect(result.allCandidateRoutes[0].costBreakdown.totalCostUSD)
      .toBeLessThanOrEqual(result.allCandidateRoutes[1].costBreakdown.totalCostUSD);
  });

  it('applies the 5-axle multiplier to the base toll', () => {
    const result = optimizeTollRoutes(routes, { grossPayoutUSD: 0, axleCount: 5 });
    const tollRoute = result.allCandidateRoutes.find((r) => r.routeId === 'toll-route');
    expect(tollRoute.isTollRoute).toBe(true);
    // baseToll 40 * multiplier 2.5 = 100
    expect(tollRoute.costBreakdown.tollCostUSD).toBe(100);
  });

  it('uses multiplier 1.0 for fewer than 5 axles', () => {
    const result = optimizeTollRoutes(routes, { grossPayoutUSD: 0, axleCount: 3 });
    const tollRoute = result.allCandidateRoutes.find((r) => r.routeId === 'toll-route');
    expect(tollRoute.costBreakdown.tollCostUSD).toBe(40);
  });

  it('reports potential savings >= 0 and correct fastest-route id', () => {
    const result = optimizeTollRoutes(routes, { grossPayoutUSD: 1500, axleCount: 5 });
    expect(result.optimizationSummary.potentialSavingsUSD).toBeGreaterThanOrEqual(0);
    // free-route has 9h vs toll-route 10h => fastest is free-route
    expect(result.optimizationSummary.fastestRouteId).toBe('free-route');
    expect(result.optimizationSummary.highestProfitRouteId).toBe('free-route');
  });

  it('computes net profit only when a gross payout is provided', () => {
    const withPayout = optimizeTollRoutes(routes, { grossPayoutUSD: 1500, axleCount: 5 });
    const withoutPayout = optimizeTollRoutes(routes, { axleCount: 5 });

    expect(withPayout.recommendedRoute.estimatedNetProfitUSD).toBeGreaterThan(0);
    expect(withoutPayout.recommendedRoute.estimatedNetProfitUSD).toBe(0);
  });
});
