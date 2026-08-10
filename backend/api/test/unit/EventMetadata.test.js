import { describe, it, expect } from 'vitest';
import { EventMetadata } from '../../src/core/events/EventMetadata.js';

describe('EventMetadata', () => {
  it('creates metadata with default timestamp and id', () => {
    const meta = new EventMetadata({ source: 'test-service' });

    expect(meta.source).toBe('test-service');
    expect(meta.timestamp).toBeDefined();
    expect(meta.eventId).toBeDefined();
  });
});
