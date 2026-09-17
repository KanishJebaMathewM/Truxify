import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

import { spawn } from 'child_process';
import fs from 'fs';
import { EbpfTelemetryLoader } from '../../../../ebpf/loader.js';

describe('EbpfTelemetryLoader', () => {
  let child;
  let loader;
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    child = new EventEmitter();
    handlers = new Map();
    child.on = vi.fn((event, handler) => {
      handlers.set(event, handler);
      return child;
    });
    spawn.mockReturnValue(child);
    loader = new EbpfTelemetryLoader('eth0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when the eBPF object file is missing', async () => {
    fs.existsSync.mockReturnValue(false);

    await expect(loader.load()).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(loader.isLoaded).toBe(false);
  });

  it('returns false and settles when spawn emits an error', async () => {
    const loadPromise = loader.load();
    handlers.get('error')(new Error('ip command not found'));

    await expect(loadPromise).resolves.toBe(false);
    expect(loader.isLoaded).toBe(false);
    expect(handlers.has('error')).toBe(true);
  });

  it('marks the loader as active when the child exits successfully', async () => {
    const loadPromise = loader.load();
    handlers.get('exit')(0);

    await expect(loadPromise).resolves.toBe(true);
    expect(loader.isLoaded).toBe(true);
  });

  it('returns false when the child exits unsuccessfully', async () => {
    const loadPromise = loader.load();
    handlers.get('exit')(1);

    await expect(loadPromise).resolves.toBe(false);
    expect(loader.isLoaded).toBe(false);
  });
});
