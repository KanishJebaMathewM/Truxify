import { describe, it, expect } from 'vitest';
import { enforceMaxDepth } from '../../persisted_queries.js';
describe('enforceMaxDepth', () => {
  it('passes', () => { expect(() => enforceMaxDepth({ selectionSet: { selections: [{}] } })).not.toThrow(); });
  it('throws', () => {
    let n = {}; let c = n;
    for (let i = 0; i < 10; i++) { c.selectionSet = { selections: [{}] }; c = c.selectionSet.selections[0]; }
    expect(() => enforceMaxDepth(n, 5)).toThrow(/depth/);
  });
});
