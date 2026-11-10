import { describe, expect, it } from 'vitest';
import { filterCoordinatesByRadius, getBoundingBox, isWithinBoundingBox } from '../../src/utils/coordinates.js';

// Generate destinations independently from the bounding-box implementation.
function destination(center, distance, bearing) {
  const lat = center.lat * Math.PI / 180;
  const lng = center.lng * Math.PI / 180;
  const angle = distance / 6371;
  const heading = bearing * Math.PI / 180;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(angle)
    + Math.cos(lat) * Math.sin(angle) * Math.cos(heading));
  const nextLng = lng + Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(lat),
    Math.cos(angle) - Math.sin(lat) * Math.sin(nextLat));
  return { lat: nextLat * 180 / Math.PI, lng: ((nextLng * 180 / Math.PI + 540) % 360) - 180 };
}

describe('radius prefilter retains spherical neighbors', () => {
  it.each([
    [0, 0, 100], [28.61, 77.21, 10], [70, 10, 500],
    [0, 179.9, 100], [0, -179.9, 100], [89.9, 30, 100], [-89.9, -30, 100],
  ])('retains near-boundary neighbors around (%s, %s) within %s km', (lat, lng, radius) => {
    const center = { lat, lng };
    const candidates = Array.from({ length: 16 }, (_, id) => ({
      id, ...destination(center, radius * 0.999999, id * 22.5),
    }));
    const matches = filterCoordinatesByRadius(candidates, center, radius);
    expect(matches.map((item) => item.id).sort((a, b) => a - b)).toEqual(candidates.map((item) => item.id));
  });

  it('uses a wrapped longitude interval when crossing the antimeridian', () => {
    const box = getBoundingBox(0, 179.9, 100);
    expect(box.minLng).toBeGreaterThan(box.maxLng);
    expect(isWithinBoundingBox({ lat: 0, lng: -179.9 }, box)).toBe(true);
    expect(isWithinBoundingBox({ latitude: 0, longitude: 179.8 }, box)).toBe(true);
    expect(isWithinBoundingBox({ lat: 0, lng: 0 }, box)).toBe(false);
  });

  it('keeps exact distance rejection and stats after a pole-spanning box', () => {
    const result = filterCoordinatesByRadius([
      { id: 'near', lat: 89.9, lng: 180 },
      { id: 'far', lat: 89.1, lng: 180 },
    ], { lat: 89.9, lng: 0 }, 100, { includeStats: true });
    expect(result.matches.map((item) => item.id)).toEqual(['near']);
    expect(result.stats.passedBox).toBe(2);
    expect(result.stats.matches).toBe(1);
  });

  it('covers the whole globe for a radius greater than half its circumference', () => {
    expect(getBoundingBox(45, 179, 21000)).toEqual({ minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 });
  });

  it.each([-180, 180])('keeps the center in a zero-radius box at longitude %s', (lng) => {
    const box = getBoundingBox(0, lng, 0);
    expect(isWithinBoundingBox({ lat: 0, lng }, box)).toBe(true);
    expect(isWithinBoundingBox({ lat: 0, lng: -lng }, box)).toBe(true);
    expect(isWithinBoundingBox({ lat: 0, lng: 0 }, box)).toBe(false);
  });
});
