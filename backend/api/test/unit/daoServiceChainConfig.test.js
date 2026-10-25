import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({ supabase: null, supabaseAdmin: null }));

const ENV_KEYS = ['PRIVATE_KEY', 'POLYGON_RPC_URL', 'DAO_CONTRACT_ADDRESS', 'DAO_TOKEN_ADDRESS'];

async function freshService() {
  const { default: singleton } = await import('../../../dao/dao.service.js');
  const Service = Object.getPrototypeOf(singleton).constructor;
  return new Service();
}

describe('DAO service chain configuration', () => {
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

  it('loads without PRIVATE_KEY or contract addresses', async () => {
    await expect(import('../../../dao/dao.service.js')).resolves.toBeDefined();
  });

  it('reports the missing configuration only when the chain is actually used', async () => {
    const service = await freshService();

    expect(() => service.wallet).toThrow('DAO chain access is not configured: set PRIVATE_KEY');
    process.env.PRIVATE_KEY = ethers.Wallet.createRandom().privateKey;
    expect(() => service.dao).toThrow('set DAO_CONTRACT_ADDRESS');
  });

  it('builds the signer and contract on first use once configured, and reuses them', async () => {
    const wallet = ethers.Wallet.createRandom();
    const contractAddress = ethers.Wallet.createRandom().address;
    process.env.PRIVATE_KEY = wallet.privateKey;
    process.env.DAO_CONTRACT_ADDRESS = contractAddress;
    const service = await freshService();

    expect(service.wallet.address).toBe(wallet.address);
    expect(service.dao.target).toBe(contractAddress);
    expect(typeof service.dao.createProposal).toBe('function');
    expect(service.dao).toBe(service.dao);
  });

  it('still lets tests inject a contract double', async () => {
    const service = await freshService();
    const fake = { createProposal: vi.fn() };
    service.dao = fake;
    expect(service.dao).toBe(fake);
  });
});
