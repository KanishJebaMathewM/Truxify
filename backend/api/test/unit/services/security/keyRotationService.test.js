import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('KeyRotationService', () => {
  beforeEach(() => vi.resetModules());
  it('module is importable', async () => {
    const mod = await import('../../../../src/services/security/keyRotationService.js');
    expect(mod).toBeDefined();
  });
  it('exports KeyRotationService class', async () => {
    const { KeyRotationService } = await import('../../../../src/services/security/keyRotationService.js');
    expect(KeyRotationService).toBeDefined();
    const svc = new KeyRotationService(); expect(svc).toBeDefined();
  });
});
