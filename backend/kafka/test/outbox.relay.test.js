import { describe, it, expect, vi } from 'vitest';
import { publishWithBackoff } from '../../relay/outbox.relay.js';
describe('publishWithBackoff', () => {
  it('success', async () => { expect(await publishWithBackoff(async () => 'ok', {})).toBe('ok'); });
  it('retries 5x', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('x'));
    await expect(publishWithBackoff(fn, {})).rejects.toThrow('x');
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
