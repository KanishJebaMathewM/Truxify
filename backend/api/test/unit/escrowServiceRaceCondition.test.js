import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Mock @supabase/supabase-js
let mockSupabaseStore = {};
let mockBlockchainTxWait;

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      from: (table) => ({
        select: (fields) => ({
          eq: (col1, val1) => ({
            single: async () => {
              const row = mockSupabaseStore[val1];
              if (!row) return { data: null, error: { message: 'Not found' } };
              return { data: row, error: null };
            },
            maybeSingle: async () => {
              const row = mockSupabaseStore[val1];
              return { data: row || null, error: null };
            },
          }),
        }),
        update: (updates) => ({
          eq: (col1, val1) => ({
            eq: (col2, val2) => ({
              select: () => ({
                maybeSingle: async () => {
                  const row = mockSupabaseStore[val1];
                  if (!row) return { data: null, error: null };
                  // Check conditional match (e.g. escrow_status === 'deposited')
                  if (row[col2] !== val2) {
                    return { data: null, error: null }; // Condition failed (atomic lock rejected)
                  }
                  Object.assign(row, updates);
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };
});

// Mock ethers
vi.mock('ethers', () => {
  return {
    ethers: {
      id: vi.fn((str) => `0x${Buffer.from(str).toString('hex').padStart(64, '0')}`),
      getAddress: vi.fn((addr) => addr),
      parseEther: vi.fn((amt) => BigInt(amt) * 10n ** 18n),
      JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
      Wallet: vi.fn().mockImplementation(() => ({})),
      Contract: vi.fn().mockImplementation(() => ({
        releaseEscrow: vi.fn().mockImplementation(async () => ({
          wait: mockBlockchainTxWait,
          hash: '0xmockreleasetxhash123',
        })),
      })),
    },
  };
});

const escrowService = require('../../../backend/api/src/services/escrowService');

describe('EscrowService - Concurrent Release Race Condition Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    mockBlockchainTxWait = vi.fn().mockResolvedValue({ hash: '0xmockreleasetxhash123' });
    mockSupabaseStore = {
      'booking-valid-1': {
        id: 'booking-valid-1',
        customer_id: 'cust-100',
        status: 'completed',
        escrow_status: 'deposited',
      },
    };
  });

  it('successfully releases funds when booking is completed and deposited', async () => {
    const result = await escrowService.releaseEscrowFunds('cust-100', 'booking-valid-1');

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('0xmockreleasetxhash123');
    expect(mockSupabaseStore['booking-valid-1'].escrow_status).toBe('released');
  });

  it('prevents concurrent double release through atomic status lock', async () => {
    // Simulate 2 parallel release requests hitting releaseEscrowFunds at the same instant
    const p1 = escrowService.releaseEscrowFunds('cust-100', 'booking-valid-1');
    const p2 = escrowService.releaseEscrowFunds('cust-100', 'booking-valid-1');

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one should succeed and the other must be rejected
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.message).toContain('already in progress');
  });

  it('rejects release if booking is not in completed status', async () => {
    mockSupabaseStore['booking-pending'] = {
      id: 'booking-pending',
      customer_id: 'cust-100',
      status: 'in_progress',
      escrow_status: 'deposited',
    };

    await expect(
      escrowService.releaseEscrowFunds('cust-100', 'booking-pending')
    ).rejects.toThrow('Escrow can only be released for completed bookings');
  });

  it('rejects release if escrow_status is not deposited', async () => {
    mockSupabaseStore['booking-released'] = {
      id: 'booking-released',
      customer_id: 'cust-100',
      status: 'completed',
      escrow_status: 'released',
    };

    await expect(
      escrowService.releaseEscrowFunds('cust-100', 'booking-released')
    ).rejects.toThrow('Escrow has already been released for this booking');
  });

  it('rolls back atomic lock to deposited if blockchain transaction fails', async () => {
    mockBlockchainTxWait = vi.fn().mockRejectedValue(new Error('Blockchain RPC timeout'));

    await expect(
      escrowService.releaseEscrowFunds('cust-100', 'booking-valid-1')
    ).rejects.toThrow('Blockchain RPC timeout');

    // Escrow status should have been restored to 'deposited' allowing subsequent retries
    expect(mockSupabaseStore['booking-valid-1'].escrow_status).toBe('deposited');
  });
});
