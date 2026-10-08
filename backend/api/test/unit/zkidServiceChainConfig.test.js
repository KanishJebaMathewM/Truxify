import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({ supabase: null, supabaseAdmin: null }));

const ENV_KEYS = ['PRIVATE_KEY', 'ZKID_CONTRACT_ADDRESS', 'POLYGON_RPC_URL'];

describe('ZKIDService chain configuration', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.POLYGON_RPC_URL = 'http://127.0.0.1:1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('loads without PRIVATE_KEY or a contract address', async () => {
    await expect(import('../../../zkid/zkid.service.js')).resolves.toBeDefined();
  });

  it('reports the missing configuration only when the chain is actually used', async () => {
    const { ZKIDService } = await import('../../../zkid/zkid.service.js');
    const service = new ZKIDService();

    expect(() => service.wallet).toThrow('ZK-ID chain access is not configured: set PRIVATE_KEY');
    process.env.PRIVATE_KEY = ethers.Wallet.createRandom().privateKey;
    expect(() => service.zkid).toThrow('set ZKID_CONTRACT_ADDRESS');
  });

  it('builds the signer and contract on first use once configured, and reuses them', async () => {
    const wallet = ethers.Wallet.createRandom();
    process.env.PRIVATE_KEY = wallet.privateKey;
    const contractAddress = ethers.Wallet.createRandom().address;
    process.env.ZKID_CONTRACT_ADDRESS = contractAddress;
    const { ZKIDService } = await import('../../../zkid/zkid.service.js');
    const service = new ZKIDService();

    expect(service.wallet.address).toBe(wallet.address);
    expect(service.zkid.target).toBe(contractAddress);
    expect(typeof service.zkid.isCredentialValid).toBe('function');
    expect(service.zkid).toBe(service.zkid);
  });

  it('still lets tests inject a contract double', async () => {
    const { ZKIDService } = await import('../../../zkid/zkid.service.js');
    const service = new ZKIDService();
    const fake = { isCredentialValid: vi.fn() };
    service.zkid = fake;
    expect(service.zkid).toBe(fake);
  });
});
