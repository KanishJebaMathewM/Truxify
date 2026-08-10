import { describe, it, expect } from 'vitest';
import BatchCallBuilder from '../../../../src/services/blockchain/batchCallBuilder.js';

describe('batchCallBuilder', () => {
  it('creates BatchCallBuilder instance', () => {
    const builder = new BatchCallBuilder();
    expect(builder).toBeDefined();
  });
});
