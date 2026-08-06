import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/tracing/tracing.js', () => ({}));
vi.mock('../../../src/core/telemetry/SpanFactory.js', () => ({
  default: { startEventHandlerSpan: () => ({ setStatus: () => {}, end: () => {} }), recordError: () => {} }
}));

import eventBus from '../../../src/core/events/index.js';

describe('reputationSubscriber', () => {
  it('verifies eventBus exists for subscribers', () => {
    expect(eventBus).toBeDefined();
  });
});
