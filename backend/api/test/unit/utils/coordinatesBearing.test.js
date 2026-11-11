import { describe, it, expect } from 'vitest';
import { calculateBearing, getCardinalDirection } from '../../../src/utils/coordinates.js';

describe('calculateBearing and getCardinalDirection', () => {
  it('calculates cardinal bearings correctly', () => {
    // Due North
    expect(calculateBearing(0, 0, 10, 0)).toBe(0);
    expect(getCardinalDirection(0)).toBe('N');

    // Due East
    expect(calculateBearing(0, 0, 0, 10)).toBe(90);
    expect(getCardinalDirection(90)).toBe('E');

    // Due South
    expect(calculateBearing(10, 0, 0, 0)).toBe(180);
    expect(getCardinalDirection(180)).toBe('S');

    // Due West
    expect(calculateBearing(0, 10, 0, 0)).toBe(270);
    expect(getCardinalDirection(270)).toBe('W');
  });

  it('maps intermediate headings to cardinal directions', () => {
    expect(getCardinalDirection(45)).toBe('NE');
    expect(getCardinalDirection(135)).toBe('SE');
    expect(getCardinalDirection(225)).toBe('SW');
    expect(getCardinalDirection(315)).toBe('NW');
  });

  it('handles invalid coordinate inputs safely', () => {
    expect(calculateBearing(null, 0, 10, 0)).toBeNull();
    expect(calculateBearing(0, NaN, 10, 0)).toBeNull();
    expect(getCardinalDirection('invalid')).toBeNull();
    expect(getCardinalDirection(null)).toBeNull();
  });
});
