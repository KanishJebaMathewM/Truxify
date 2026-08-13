import { describe, it, expect } from 'vitest';
import { resolveEnvelopeVersion } from '../../consumers/order.consumer.js';
describe('resolveEnvelopeVersion', () => {
  it('null → v1', () => { expect(resolveEnvelopeVersion(null)).toBe('v1'); });
  it('header', () => { expect(resolveEnvelopeVersion({ version: 'v2' })).toBe('v2'); });
});
