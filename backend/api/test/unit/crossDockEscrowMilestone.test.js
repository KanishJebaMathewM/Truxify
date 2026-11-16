import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/blockchain/gaslessRelayerService.js', () => ({
  GaslessRelayerService: class {
    async relayMilestoneRelease(args) {
      return { transactionHash: '0x' + 'ab'.repeat(32), blockNumber: 123, gasUsed: 21000n, ...args };
    }
  },
}));
vi.mock('../../src/services/blockchain/eip712Signer.js', () => ({
  Eip712Signer: class {},
}));

const { EscrowMilestoneStateMachine, ESCROW_MILESTONES } = await import('../../src/services/blockchain/escrowMilestoneStateMachine.js');

describe('EscrowMilestoneStateMachine', () => {
  const params = {
    bookingId: 'BK-1', amountWei: 3000n, nonce: 7,
    deadline: Math.floor(Date.now() / 1000) + 3600, signature: '0x' + 'cd'.repeat(65),
  };

  it('milestone constants encode the 30/20/50 split', () => {
    expect(ESCROW_MILESTONES).toEqual({ LOADING_ADVANCE: 1, TRANSIT_WAYPOINT: 2, DELIVERY_SETTLEMENT: 3 });
  });

  it('maps each milestone type to its id and relays', async () => {
    const sm = new EscrowMilestoneStateMachine({});
    const res = await sm.triggerMilestoneRelease({ ...params, milestoneType: 'TRANSIT_WAYPOINT' });
    expect(res.success).toBe(true);
    expect(res.milestoneId).toBe(2);
    expect(res.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('unknown milestone types are REJECTED, not silently mapped to LOADING_ADVANCE', async () => {
    const sm = new EscrowMilestoneStateMachine({});
    await expect(sm.triggerMilestoneRelease({ ...params, milestoneType: 'TOTAL_PAYOUT_NOW' }))
      .rejects.toThrow(/[Uu]nknown milestone/);
  });
});
