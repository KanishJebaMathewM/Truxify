import { describe, it, expect, vi } from 'vitest';
import { attachShutdownHandler } from '../../relay/outbox.relay.js';
describe('attachShutdownHandler', () => {
  it('registers', () => {
    const on = vi.spyOn(process, 'on').mockImplementation(() => {});
    attachShutdownHandler(async () => {}, ['SIGUSR1']);
    expect(on).toHaveBeenCalledWith('SIGUSR1', expect.any(Function));
    on.mockRestore();
  });
});
