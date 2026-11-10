import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn() } }));
import { evaluateBridgeFormulaCompliance } from '../../src/services/weighStationService.js';

function profile(weights) {
    return { axles: weights.map((weightLbs, index) => ({
        axleNumber: index + 1, weightLbs, distanceFromSteerFeet: index * 5,
    })) };
}

describe('accepted numeric axle weights', () => {
    it.each([
        ['10000', '10000'],
        [10000, '10000'],
        ['10000', 10000],
        ['10000', '10000', '10000'],
    ])('matches numeric-only evaluation for %j', (...weights) => {
        const expected = evaluateBridgeFormulaCompliance(profile(weights.map(Number)));
        expect(expected.compliant).toBe(true);
        expect(evaluateBridgeFormulaCompliance(profile(weights))).toEqual(expected);
    });

    it('reports genuine tandem and bridge overloads with numeric weights and excess', () => {
        const result = evaluateBridgeFormulaCompliance(profile(['19000', '19000']));
        expect(result).toEqual(evaluateBridgeFormulaCompliance(profile([19000, 19000])));
        expect(result.compliant).toBe(false);
        expect(result.violations).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'TANDEM_AXLE_OVERLOAD', actualWeightLbs: 38000, excessLbs: 4000 }),
            expect.objectContaining({ type: 'BRIDGE_FORMULA_GROUP_VIOLATION', actualWeightLbs: 38000, excessLbs: 3000 }),
        ]));
    });

    it('does not mutate caller axle weights', () => {
        const input = profile(['10000', 10000]);
        input.axles.forEach(Object.freeze);
        Object.freeze(input.axles);
        Object.freeze(input);
        expect(evaluateBridgeFormulaCompliance(input).compliant).toBe(true);
        expect(input.axles.map(axle => axle.weightLbs)).toEqual(['10000', 10000]);
    });

    it.each(['invalid', '-1', 'Infinity'])('preserves invalid weight rejection: %s', weight => {
        expect(evaluateBridgeFormulaCompliance(profile([10000, weight]))).toEqual({
            compliant: false,
            reason: 'Invalid axle weight for axle 2: must be non-negative finite number',
            violations: [],
        });
    });
});
