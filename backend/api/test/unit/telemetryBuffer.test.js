import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryBuffer } from '../../src/services/telemetry/telemetryBuffer.js';

describe('TelemetryBuffer', () => {
  let buffer;

  beforeEach(() => {
    // Initialize with a small max size for predictable overflow testing
    buffer = new TelemetryBuffer({ maxSize: 3 });
  });

  it('should initialize empty and respect max size configuration', () => {
    expect(buffer.size()).toBe(0);
    expect(buffer.maxSize).toBe(3);
  });

  it('should add telemetry items successfully', () => {
    buffer.add({ id: 1, metric: 'cpu_usage', value: 45 });
    expect(buffer.size()).toBe(1);
  });

  it('should flush buffered items and reset the buffer state', () => {
    buffer.add({ id: 1, metric: 'cpu_usage' });
    buffer.add({ id: 2, metric: 'memory_usage' });

    const flushed = buffer.flush();
    expect(flushed).toHaveLength(2);
    expect(flushed).toEqual([
      { id: 1, metric: 'cpu_usage' },
      { id: 2, metric: 'memory_usage' },
    ]);
    expect(buffer.size()).toBe(0);
  });

  it('should handle buffer overflow correctly when max size is exceeded', () => {
    buffer.add({ id: 1 });
    buffer.add({ id: 2 });
    buffer.add({ id: 3 });
    // Adding a 4th item should trigger overflow behavior (e.g., dropping or shifting oldest items)
    buffer.add({ id: 4 });

    expect(buffer.size()).toBeLessThanOrEqual(3);
    const flushed = buffer.flush();
    expect(flushed).toHaveLength(3);
  });

  it('should return an empty array when flushing an empty buffer', () => {
    const flushed = buffer.flush();
    expect(flushed).toEqual([]);
    expect(buffer.size()).toBe(0);
  });
});
