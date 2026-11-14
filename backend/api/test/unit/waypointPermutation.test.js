import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), predict: vi.fn(), bypass: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mocks.get } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/services/workZoneService.js', () => ({
  predictWorkZoneDelays: mocks.predict, generateBypassWaypoint: mocks.bypass,
}));
import { optimizeWaypoints } from '../../src/services/routingService.js';

const start = Object.freeze({ lat: 0, lng: 0, address: 'start' });
const end = Object.freeze({ lat: 10, lng: 10, address: 'end' });
const stops = Object.freeze(Array.from({ length: 3 }, (_, i) => Object.freeze({
  id: `stop-${i}`, lat: i + 1, lng: i + 1, address: `Delivery ${i}`,
})));
const waypoints = (indices = [0, 2, 3, 1, 4]) => indices.map((waypoint_index) => ({ waypoint_index }));
const run = (data, input = stops, date, time) => {
  mocks.get.mockResolvedValueOnce({ data });
  return optimizeWaypoints(start, end, input, date, time);
};
const fallback = async (data) => {
  const result = await run(data);
  expect(result).toEqual(stops);
  expect(result).toHaveLength(stops.length);
  result.forEach((stop, i) => expect(stop).toBe(stops[i]));
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.predict.mockResolvedValue({ hasSevereDelay: false });
});

// These cases deliberately use a non-self-inverse valid base permutation so
// rejecting metadata cannot accidentally pass by returning the same trip order.
describe('provider permutation preserves the complete delivery plan', () => {
  it.each([
    ['duplicate middle indices', waypoints([0, 2, 2, 1, 4])],
    ['fractional middle index', waypoints([0, 2.5, 3, 1, 4])],
    ['numeric string index', waypoints([0, '2', 3, 1, 4])],
    ['negative index', waypoints([0, -1, 3, 1, 4])],
    ['out-of-range index', waypoints([0, 9, 3, 1, 4])],
    ['nonfinite index', waypoints([0, Infinity, 3, 1, 4])],
    ['middle stop at endpoint', waypoints([0, 4, 3, 1, 4])],
    ['swapped endpoints', waypoints([4, 2, 3, 1, 0])],
    ['missing end', waypoints([0, 2, 3, 1])],
    ['extra provider entry', waypoints([0, 2, 3, 1, 4, 5])],
    ['null provider entry', [waypoints()[0], null, ...waypoints().slice(2)]],
    ['missing index', [waypoints()[0], {}, ...waypoints().slice(2)]],
    ['array-like object', { ...waypoints(), length: 5 }],
  ])('falls back without dropping stops for %s', async (_name, response) => {
    await fallback({ code: 'Ok', waypoints: response });
  });
  it.each([
    ['split trip', [0, 0, 1, 0, 0]],
    ['all points in nonexistent second trip', [1, 1, 1, 1, 1]],
    ['fractional trip index', [0, 0, 0.5, 0, 0]],
    ['string trip index', [0, 0, '0', 0, 0]],
    ['mixed missing trip metadata', [0, undefined, 0, 0, 0]],
    ['null trip metadata', [0, null, 0, 0, 0]],
  ])('falls back for %s', async (_name, tripIndices) => {
    const response = waypoints().map((wp, i) => ({ ...wp, trips_index: tripIndices[i] }));
    await fallback({ code: 'Ok', waypoints: response });
  });
  it.each([['empty', []], ['multiple', [{}, {}]], ['null', null], ['object', {}]])('rejects an explicitly invalid trips container %s', async (_name, trips) => {
    await fallback({ code: 'Ok', waypoints: waypoints(), trips });
  });
  it('reconstructs non-self-inverse permutations in OSRM input-order semantics', async () => {
    const result = await run({ code: 'Ok', waypoints: waypoints(), trips: [{}] });
    expect(result).toEqual([stops[2], stops[0], stops[1]]);
    result.forEach((stop, i) => expect(stop).toBe([stops[2], stops[0], stops[1]][i]));
  });
  it('accepts complete explicit single-trip metadata', async () => {
    const result = await run({ code: 'Ok', trips: [{}],
      waypoints: waypoints().map((wp) => ({ ...wp, trips_index: 0 })),
    });
    expect(result).toEqual([stops[2], stops[0], stops[1]]);
  });
  it('preserves distinct stops sharing the same coordinate', async () => {
    const input = [{ id: 'A', lat: 1, lng: 1 }, { id: 'B', lat: 1, lng: 1 }];
    const result = await run({ code: 'Ok', waypoints: waypoints([0, 2, 1, 3]) }, input);
    expect(result[0]).toBe(input[1]);
    expect(result[1]).toBe(input[0]);
  });
  it('retains a predictive bypass when the provider permutation is malformed', async () => {
    const bypass = Object.freeze({ id: 'bypass', lat: 4, lng: 4 });
    mocks.predict.mockResolvedValueOnce({ hasSevereDelay: true, problematicPoint: start });
    mocks.bypass.mockReturnValueOnce(bypass);
    const result = await run({ code: 'Ok', waypoints: waypoints([0, 1, 1, 3, 4, 5]) }, stops, '2026-10-02', '10:00');
    expect(result).toEqual([...stops, bypass]);
    expect(result.at(-1)).toBe(bypass);
    expect(stops).toHaveLength(3);
  });
  it('reorders the bypass as an ordinary original stop for a valid response', async () => {
    const bypass = { id: 'bypass', lat: 4, lng: 4 };
    mocks.predict.mockResolvedValueOnce({ hasSevereDelay: true, problematicPoint: start });
    mocks.bypass.mockReturnValueOnce(bypass);
    const result = await run({ code: 'Ok', waypoints: waypoints([0, 2, 3, 4, 1, 5]) }, stops, '2026-10-02', '10:00');
    expect(result).toEqual([bypass, ...stops]);
    expect(result[0]).toBe(bypass);
  });
  it('preserves request options and complete fallback on transport timeout', async () => {
    mocks.get.mockRejectedValueOnce(new Error('timeout'));
    expect(await optimizeWaypoints(start, end, stops)).toEqual(stops);
    expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('roundtrip=false&source=first&destination=last'), { timeout: 10000 });
  });
  it('keeps invalid-coordinate fallback and makes no provider request', async () => {
    expect(await optimizeWaypoints({ lat: Infinity, lng: 0 }, end, stops)).toEqual(stops);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('checks all 152 permutations for two through five middle stops', async () => {
    // Independent oracle: derive input-order indices from a trip-order list,
    // then compare returned stop identities with that trip-order list.
    const permutations = (values) => values.length === 0 ? [[]] : values.flatMap((value, i) =>
      permutations(values.filter((_v, j) => j !== i)).map((tail) => [value, ...tail]));
    let checked = 0;
    for (let n = 2; n <= 5; n++) {
      const input = Array.from({ length: n }, (_, i) => ({ id: i, lat: i + 1, lng: i + 1 }));
      for (const order of permutations(input)) {
        const indices = [0, ...input.map((stop) => order.indexOf(stop) + 1), n + 1];
        const result = await run({ code: 'Ok', waypoints: waypoints(indices) }, input);
        expect(result).toHaveLength(n);
        result.forEach((stop, i) => expect(stop).toBe(order[i]));
        checked++;
      }
    }
    expect(checked).toBe(152);
  });
});
