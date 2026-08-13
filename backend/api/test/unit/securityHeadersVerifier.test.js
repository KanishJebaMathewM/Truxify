import { describe, it, expect } from 'vitest';
import { safeSetHeader } from '../../src/middleware/securityHeadersVerifier.js';
describe('safeSetHeader', () => {
  it('sets when missing', () => {
    const r = { _h: {}, getHeader(k){return this._h[k];}, setHeader(k,v){this._h[k]=v;} };
    expect(safeSetHeader(r, 'X', '1')).toBe(true);
  });
  it('skips when set', () => {
    const r = { _h: { X: '0' }, getHeader(k){return this._h[k];}, setHeader(k,v){this._h[k]=v;} };
    expect(safeSetHeader(r, 'X', '1')).toBe(false);
  });
});
