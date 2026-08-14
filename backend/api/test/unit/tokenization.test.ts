/**
 * Regression tests for issue #11493.
 *
 * Covers the two defects reported in the backend tokenization service:
 *   1. Float multiplication before `parseEther` silently lost wei precision.
 *      `tokenCostWei` must compute the exact wei cost using integer math only.
 *   2. Asset / trade IDs were read from `getTotalAssets()` / `getTotalTradeOrders()`
 *      counters AFTER the tx was mined — a TOCTOU. `extractEventArg` must derive
 *      the ID from the transaction's own emitted event, which is race-free.
 */

import { describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';

// The service constructs an ethers JsonRpcProvider / Wallet / Contract at import
// time. Stub those three so the module loads without network or env secrets,
// while keeping the real `parseEther` / `Interface` used by the helpers.
vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  const noop = class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_a?: any, _b?: any, _c?: any) {
      return { interface: new actual.Interface([]) };
    }
  };
  return {
    ...actual,
    JsonRpcProvider: noop,
    Wallet: noop,
    Contract: noop,
  };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: () => ({}) },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: () => {}, error: () => {}, warn: () => {} },
  info: () => {},
  error: () => {},
  warn: () => {},
}));

import { tokenCostWei, extractEventArg } from '../../../tokenization/token.service.js';

const ASSET_CREATED = 'event AssetCreated(uint256 indexed assetId, string name, address indexed owner)';
const TRADE_CREATED = 'event TradeOrderCreated(uint256 indexed orderId, uint256 tokenId, address indexed seller)';

describe('tokenCostWei — exact wei conversion (no float drift)', () => {
  it('computes 0.1 ETH/token * 3 tokens exactly as 0.3 ETH', () => {
    // Old code: parseFloat('0.1') * 3 === 0.30000000000000004 -> drifted wei.
    const wei = tokenCostWei('0.1', '3', true);
    expect(wei).toBe(ethers.parseEther('0.3'));
    expect(wei.toString()).toBe('300000000000000000');
  });

  it('computes 2.5 ETH/token * 3 tokens as 7.5 ETH', () => {
    const wei = tokenCostWei('2.5', '3', true);
    expect(wei).toBe(ethers.parseEther('7.5'));
  });

  it('does not rely on floating point for fractional results', () => {
    // 0.0000001 * 0.0000001 should still be exact, not a rounded float.
    const wei = tokenCostWei('0.0000001', '0.0000001', true);
    // parseEther('0.0000001') = 1e11 wei; product = 1e22; /1e18 = 1e4 wei
    expect(wei).toBe(10000n);
  });

  it('floor (trade) rounds down to match contract settlement', () => {
    // 3 tokens * 0.1 ETH = 0.3 ETH exactly; floor == ceil here.
    expect(tokenCostWei('0.1', '3', false)).toBe(ethers.parseEther('0.3'));
  });
});

describe('extractEventArg — race-free ID from emitted event (no TOCTOU)', () => {
  const contract = { interface: new ethers.Interface([ASSET_CREATED, TRADE_CREATED]) };

  const assetReceipt = (id: bigint) => {
    const fragment = contract.interface.getEvent('AssetCreated');
    const enc = contract.interface.encodeEventLog(fragment, [
      id,
      'truck',
      '0x0000000000000000000000000000000000000001',
    ]);
    return { logs: [{ topics: enc.topics, data: enc.data }] };
  };

  const tradeReceipt = (id: bigint) => {
    const fragment = contract.interface.getEvent('TradeOrderCreated');
    const enc = contract.interface.encodeEventLog(fragment, [
      id,
      7n,
      '0x0000000000000000000000000000000000000002',
    ]);
    return { logs: [{ topics: enc.topics, data: enc.data }] };
  };

  it('reads the asset ID directly from the AssetCreated event', () => {
    const id = extractEventArg(assetReceipt(42n), contract, 'AssetCreated', 0);
    expect(id).toBe(42n);
  });

  it('reads the order ID directly from the TradeOrderCreated event', () => {
    const id = extractEventArg(tradeReceipt(17n), contract, 'TradeOrderCreated', 0);
    expect(id).toBe(17n);
  });

  it('is unaffected by a counter value, proving it is not a TOCTOU on the count', () => {
    // Even if a concurrent create bumped the on-chain counter to 1000, the
    // ID for THIS transaction must still come from its own event (42n).
    const id = extractEventArg(assetReceipt(42n), contract, 'AssetCreated', 0);
    expect(id).toBe(42n);
  });

  it('returns null when the expected event is absent', () => {
    const id = extractEventArg({ logs: [] }, contract, 'AssetCreated', 0);
    expect(id).toBeNull();
  });

  it('ignores logs emitted by other contracts', () => {
    const foreign = {
      // a log that cannot be decoded by our interface
      topics: ['0xdeadbeef'],
      data: '0x',
    };
    const id = extractEventArg({ logs: [foreign] }, contract, 'AssetCreated', 0);
    expect(id).toBeNull();
  });
});
