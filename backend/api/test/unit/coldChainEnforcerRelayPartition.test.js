import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { generateEvidenceHash, enforceSLAPenalty, getBookingBreaches } = await import('../../src/services/coldChainEscrowEnforcer.js');
const { partitionRouteIntoCorridorLegs } = await import('../../src/services/relayDispatchService.js');

describe('coldChainEscrowEnforcer', () => {
  it('rejects incomplete breach events', async () => {
    await expect(enforceSLAPenalty({ breachType: 'TEMP', observedValue: 12 })).rejects.toThrow(/required/);
    await expect(enforceSLAPenalty({ bookingId: 'B1', observedValue: 12 })).rejects.toThrow(/required/);
    await expect(enforceSLAPenalty({ bookingId: 'B1', breachType: 'TEMP' })).rejects.toThrow(/required/);
  });

  it('records a breach with an evidence hash + on-chain receipt shape', async () => {
    const res = await enforceSLAPenalty({ bookingId: 'BK-T1', breachType: 'TEMP_EXCURSION', observedValue: 12.5, excursionMinutes: 20 });
    expect(res.success).toBe(true);
    expect(res.receipt.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.receipt.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.receipt.status).toBe('RECORDED_ON_CHAIN');
    expect(res.receipt.excursionMinutes).toBe(20);
  });

  it('evidence hashes are unique per breach (random nonce)', () => {
    const a = generateEvidenceHash('B1', 'TEMP', 12, '2026-10-14T00:00:00Z');
    const b = generateEvidenceHash('B1', 'TEMP', 12, '2026-10-14T00:00:00Z');
    expect(a).not.toBe(b);
  });

  it('getBookingBreaches accumulates per booking and isolates others', async () => {
    const id = `BK-${Date.now()}`;
    await enforceSLAPenalty({ bookingId: id, breachType: 'TEMP', observedValue: 10 });
    await enforceSLAPenalty({ bookingId: id, breachType: 'SHOCK', observedValue: 5 });
    const breaches = getBookingBreaches(id);
    expect(breaches.length).toBe(2);
    expect(getBookingBreaches(`OTHER-${Date.now()}`)).toEqual([]);
  });
});

describe('relayDispatchService.partitionRouteIntoCorridorLegs', () => {
  const DELHI = { lat: 28.6139, lng: 77.209, address: 'Delhi' };
  const JAIPUR = { lat: 26.9124, lng: 75.7873, address: 'Jaipur' };   // ~270km
  const CHENNAI = { lat: 13.0827, lng: 80.2707, address: 'Chennai' }; // ~1750km from Delhi

  it('short hauls (<200km) stay single-driver with the full amount on one leg', () => {
    const res = partitionRouteIntoCorridorLegs(
      { lat: 28.6139, lng: 77.209, address: 'Delhi' },
      { lat: 28.7041, lng: 77.1122, address: 'Delhi NCR' },
      50000
    );
    expect(res.isRelayApplicable).toBe(false);
    expect(res.legs).toHaveLength(1);
    expect(res.legs[0].isFinalLeg).toBe(true);
    expect(res.legs[0].legAmount).toBe(50000);
  });

  it('long hauls split into multiple legs with proportional payout shares summing to 100%', () => {
    const res = partitionRouteIntoCorridorLegs(DELHI, CHENNAI, 300000);
    expect(res.isRelayApplicable).not.toBe(false);
    expect(res.legs.length).toBeGreaterThan(1);
    const totalShare = res.legs.reduce((s, l) => s + l.payoutSharePercentage, 0);
    expect(totalShare).toBeGreaterThan(99);
    expect(totalShare).toBeLessThan(100.5);
    const totalAmount = res.legs.reduce((s, l) => s + l.legAmount, 0);
    expect(Math.abs(totalAmount - 300000)).toBeLessThan(10);
  });

  it('legs are sequential (each origin = previous destination) and the last reaches the destination', () => {
    const res = partitionRouteIntoCorridorLegs(DELHI, CHENNAI, 100000);
    const legs = res.legs;
    for (let i = 1; i < legs.length; i++) {
      expect(legs[i].origin.lat).toBeCloseTo(legs[i - 1].destination.lat, 6);
      expect(legs[i].origin.lng).toBeCloseTo(legs[i - 1].destination.lng, 6);
    }
    expect(legs.at(-1).isFinalLeg).toBe(true);
    expect(legs.at(-1).destination.lat).toBeCloseTo(CHENNAI.lat, 6);
  });

  it('each leg carries a deterministic hub waypoint hash', () => {
    const res = partitionRouteIntoCorridorLegs(DELHI, CHENNAI, 50000);
    for (const leg of res.legs) {
      expect(leg.hubWaypointHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('intermediate legs terminate at real hubs when available', () => {
    const res = partitionRouteIntoCorridorLegs(DELHI, CHENNAI, 50000);
    const hubbed = res.legs.filter((l) => l.hub);
    expect(hubbed.length).toBeGreaterThan(0, 'the Delhi→Chennai NH44 corridor crosses registered hubs');
    for (const leg of hubbed) {
      expect(leg.destination.address).toBe(leg.hub.name);
    }
  });
});
