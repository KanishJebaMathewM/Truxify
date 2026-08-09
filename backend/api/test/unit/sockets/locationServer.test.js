import { describe, it, expect } from 'vitest';
import { getActiveDriverCount } from '../../../src/sockets/locationServer.js';

describe('locationServer Socket', () => {
  it('returns active driver count', () => {
    expect(typeof getActiveDriverCount()).toBe('number');
  });
});
