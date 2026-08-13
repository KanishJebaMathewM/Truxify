import { describe, it, expect } from 'vitest';
function paisaToMatic(p) {
  if (p==null) return null; const n=Number(p);
  if (!Number.isFinite(n)) return null;
  return Math.round(n/100000);
}
function maticToPaisa(m) {
  if (m==null) return null; const n=Number(m);
  if (!Number.isFinite(n)) return null;
  return Math.round(n*100000);
}
function roundPrice(v, d=2) {
  if (v==null) return null; const n=Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n*Math.pow(10,d))/Math.pow(10,d);
}
describe('priceRounding', () => {
  describe('paisaToMatic', () => {
    it('converts correctly', () => { expect(paisaToMatic(100000)).toBe(1); expect(paisaToMatic(500000)).toBe(5); });
    it('rounds to nearest integer', () => { expect(paisaToMatic(150000)).toBe(2); expect(paisaToMatic(149999)).toBe(1); });
    it('handles zero', () => expect(paisaToMatic(0)).toBe(0));
    it('returns null for null', () => { expect(paisaToMatic(null)).toBeNull(); expect(paisaToMatic(undefined)).toBeNull(); });
    it('returns null for non-finite', () => { expect(paisaToMatic(NaN)).toBeNull(); expect(paisaToMatic(Infinity)).toBeNull(); });
  });
  describe('maticToPaisa', () => {
    it('converts correctly', () => { expect(maticToPaisa(1)).toBe(100000); expect(maticToPaisa(5)).toBe(500000); expect(maticToPaisa(0.5)).toBe(50000); });
    it('handles zero', () => expect(maticToPaisa(0)).toBe(0));
    it('returns null for null', () => expect(maticToPaisa(null)).toBeNull());
    it('returns null for non-finite', () => expect(maticToPaisa(NaN)).toBeNull());
  });
  describe('roundPrice', () => {
    it('rounds to 2dp by default', () => { expect(roundPrice(1.234)).toBe(1.23); expect(roundPrice(1.235)).toBe(1.24); });
    it('respects custom decimals', () => expect(roundPrice(1.2345,3)).toBe(1.235));
    it('returns null for null', () => expect(roundPrice(null)).toBeNull());
    it('returns null for non-finite', () => { expect(roundPrice(NaN)).toBeNull(); expect(roundPrice(Infinity)).toBeNull(); });
    it('handles zero and negatives', () => { expect(roundPrice(0)).toBe(0); expect(roundPrice(-1.234)).toBe(-1.23); });
  });
});
