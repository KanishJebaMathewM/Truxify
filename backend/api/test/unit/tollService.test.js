import { describe, expect, it } from 'vitest';
import {
  VEHICLE_AXLE_CLASSES,
  NHAI_TOLL_PLAZAS,
  calculatePlazaFee,
  estimateRouteTolls,
  listAllPlazas,
} from '../../src/services/tollService.js';

describe('tollService.calculatePlazaFee', () => {
  const plaza = { id: 'TP_TEST', name: 'Test Plaza', highway: 'NH44', state: 'Haryana', lat: 29.0, lng: 77.0, baseRateInr: 100 };

  it('applies the vehicle-class multiplier (LCV 1.0 → MAV 2.8 → 7+ axle 3.5)', () => {
    expect(calculatePlazaFee(plaza, 'LCV').feeInr).toBe(100);
    expect(calculatePlazaFee(plaza, '2_AXLE_TRUCK').feeInr).toBe(160);
    expect(calculatePlazaFee(plaza, '3_AXLE_TRUCK').feeInr).toBe(210);
    expect(calculatePlazaFee(plaza, '4_6_AXLE_MAV').feeInr).toBe(280);
    expect(calculatePlazaFee(plaza, '7_AXLE_OVERSIZED').feeInr).toBe(350);
  });

  it('unknown vehicle class falls back to 2-axle truck', () => {
    const res = calculatePlazaFee(plaza, 'SPACESHIP');
    expect(res.vehicleClass).toBe('2_AXLE_TRUCK');
    expect(res.feeInr).toBe(160);
  });

  it('missing baseRate defaults to ₹100', () => {
    const noRate = { ...plaza, baseRateInr: undefined };
    expect(calculatePlazaFee(noRate, 'LCV').feeInr).toBe(100);
  });

  it('fee carries the plaza metadata through', () => {
    const res = calculatePlazaFee(plaza, 'LCV');
    expect(res.plazaId).toBe('TP_TEST');
    expect(res.vehicleClassLabel).toMatch(/Light Commercial/);
  });
});

describe('tollService registry integrity', () => {
  it('every plaza has the required fields and sane coordinates', () => {
    expect(NHAI_TOLL_PLAZAS.length).toBeGreaterThan(10);
    for (const p of NHAI_TOLL_PLAZAS) {
      expect(p.id).toBeTruthy();
      expect(p.highway).toMatch(/^NH/);
      expect(p.lat).toBeGreaterThan(6);
      expect(p.lat).toBeLessThan(38);   // India's lat range
      expect(p.lng).toBeGreaterThan(68);
      expect(p.lng).toBeLessThan(98);   // India's lng range
      expect(p.baseRateInr).toBeGreaterThan(0);
    }
  });

  it('plaza ids are unique', () => {
    const ids = NHAI_TOLL_PLAZAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('listAllPlazas filters by highway case-insensitively', () => {
    const nh44 = listAllPlazas('nh44');
    expect(nh44.length).toBeGreaterThan(0);
    for (const p of nh44) expect(p.highway).toBe('NH44');
    expect(listAllPlazas().length).toBe(NHAI_TOLL_PLAZAS.length);
  });
});

describe('tollService.estimateRouteTolls', () => {
  it('rejects missing/invalid coordinates with a 400 DomainError', () => {
    expect(() => estimateRouteTolls(null, { lat: 28, lng: 77 })).toThrow(/coordinates are required/);
    expect(() => estimateRouteTolls({ lat: 28, lng: 77 }, {})).toThrow(/coordinates are required/);
  });

  it('detects plazas along a route corridor (Delhi → Murthal on NH44)', () => {
    const res = estimateRouteTolls(
      { lat: 28.6139, lng: 77.2090 },   // Delhi
      { lat: 29.2000, lng: 77.1000 },   // north past Murthal
      'LCV'
    );
    expect(res.success).toBe(true);
    const ids = res.plazas.map((p) => p.plazaId);
    expect(ids).toContain('TP_NH44_MURTHAL');
    expect(res.totalTollEstimateInr).toBeGreaterThan(0);
    expect(res.totalTollEstimateInr).toBe(res.plazas.reduce((s, p) => s + p.feeInr, 0));
  });

  it('a route far from any plaza crosses none', () => {
    const res = estimateRouteTolls(
      { lat: 12.9716, lng: 77.5946 },   // Bengaluru
      { lat: 12.2958, lng: 76.6394 },   // Mysuru
      'LCV'
    );
    expect(res.totalPlazasCrossed).toBe(0);
    expect(res.totalTollEstimateInr).toBe(0);
  });

  it('waypoints extend the corridor detection', () => {
    // Direct Bengaluru→Chennai skips the Hosur plaza segment; forcing a
    // waypoint through Hosur must pick up NH44 plazas on that stretch.
    const direct = estimateRouteTolls({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 }, 'LCV');
    const viaHosur = estimateRouteTolls(
      { lat: 12.9716, lng: 77.5946 },
      { lat: 13.0827, lng: 80.2707 },
      'LCV',
      [{ lat: 12.7409, lng: 77.8253 }]   // Hosur
    );
    expect(viaHosur.totalPlazasCrossed).toBeGreaterThanOrEqual(direct.totalPlazasCrossed);
  });

  it('a plaza on the corridor is counted once even across overlapping segments', () => {
    const res = estimateRouteTolls(
      { lat: 28.9, lng: 77.05 },
      { lat: 29.2, lng: 77.12 },
      '2_AXLE_TRUCK',
      [{ lat: 29.03, lng: 77.07 }] // waypoint right on Murthal
    );
    const murthalHits = res.plazas.filter((p) => p.plazaId === 'TP_NH44_MURTHAL');
    expect(murthalHits.length).toBe(1, 'duplicate plaza counting inflates tolls');
  });
});
