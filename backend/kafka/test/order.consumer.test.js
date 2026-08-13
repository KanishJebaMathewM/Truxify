import { describe, it, expect, vi } from 'vitest';
import { recreateConsumer } from '../../config/kafka.config.js';
describe('recreateConsumer', () => {
  it('disconnects', async () => {
    const old = { disconnect: vi.fn().mockResolvedValue() };
    expect(await recreateConsumer(old, () => ({}))).toEqual({});
    expect(old.disconnect).toHaveBeenCalled();
  });
});
