import { describe, expect, it } from 'vitest';
import { compareHlc, generateServerHlc } from '../../src/services/crdtSyncService.js';

describe('crdtSyncService HLC (hybrid logical clock)', () => {
  it('orders by millis, then counter, then node id', () => {
    expect(compareHlc('1000:1:a', '1000:1:b')).toBe(-1);
    expect(compareHlc('1000:2:a', '1000:1:b')).toBe(1);
    expect(compareHlc('1001:0:a', '1000:9:z')).toBe(1);
    expect(compareHlc('1000:1:a', '1000:1:a')).toBe(0);
  });

  it('null/empty handling: both null equal; null sorts first', () => {
    expect(compareHlc(null, null)).toBe(0);
    expect(compareHlc(null, '1:1:a')).toBe(-1);
    expect(compareHlc('1:1:a', '')).toBe(1);
  });

  it('is a consistent total order (antisymmetry + transitivity spot-check)', () => {
    const stamps = ['1000:1:a', '1000:1:b', '1000:2:a', '1001:0:a', '999:9:z'];
    for (const a of stamps) {
      for (const b of stamps) {
        const ab = compareHlc(a, b), ba = compareHlc(b, a);
        expect(Math.sign(ab) === 0 ? 0 : Math.sign(ab)).toBe(Math.sign(ba) === 0 ? 0 : -Math.sign(ba));
      }
    }
    const sorted = [...stamps].sort(compareHlc);
    expect(sorted).toEqual(['999:9:z', '1000:1:a', '1000:1:b', '1000:2:a', '1001:0:a']);
  });

  it('generateServerHlc advances the counter and never goes below the client clock', () => {
    const future = `${Date.now() + 3_600_000}:99:client_x`; // client 1h ahead (clock skew)
    const s1 = generateServerHlc(future);
    const [millis] = s1.split(':');
    expect(Number(millis)).toBeGreaterThanOrEqual(Date.now() + 3_600_000 - 1000);
    const s2 = generateServerHlc(null);
    expect(compareHlc(s2, s1)).toBe(1, 'server stamps must be monotonically increasing (millis must never regress)');
  });

  it('server stamps carry the server node id', () => {
    expect(generateServerHlc().endsWith(':server_node_01')).toBe(true);
  });
});
