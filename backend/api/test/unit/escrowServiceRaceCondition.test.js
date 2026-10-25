import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock state storage
let mockSupabaseStore = {};
let mockBlockchainTxWait;

// Mock database configuration
vi.mock('../../src/config/db.js', () => ({
  supabase: {
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
                // Conditional match check for atomic status locking
                if (row[col2] !== val2) {
                  return { data: null, error: null };
                }
                Object.assign(row, updates);
                return { data: row, error: null };
              },
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async (functionName, args) => {
      const bookingId = args.p_booking_id || args.p_order_id;
      const row = mockSupabaseStore[bookingId];

      if (!row) {
        return { data: null, error: { message: 'Order/Booking not found' } };
      }

      if (row.status !== 'completed') {
        return {
          data: null,
          error: { message: 'Escrow can only be released for completed bookings' },
        };
      }

      if (row.escrow_status === 'releasing') {
        return {
          data: null,
          error: { message: 'Escrow release is already in progress' },
        };
      }

      if (row.escrow_status === 'released') {
        return {
          data: null,
          error: { message: 'Escrow has already been released for this booking' },
        };
      }

      // Set atomic lock
      row.escrow_status = 'releasing';

      try {
        if (mockBlockchainTxWait) {
          await mockBlockchainTxWait();
        }
        row.escrow_status = 'released';
        return {
          data: { txHash: '0xmockreleasetxhash123', status: 'released' },
          error: null,
        };
      } catch (err) {
        // Rollback lock on failure
        row.escrow_status = 'deposited';
        return { data: null, error: { message: err.message } };
      }
    }),
  },
  supabaseAdmin: null,
}));

// Mock ethers library
vi.mock('ethers', () => ({
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
}));

// Live ESM service import
import { escrowRelease } from '../../src/services/escrow.js';

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
    const result = await escrowRelease('booking-valid-1');

    expect(result).toBeDefined();
    expect(result.txHash).toBe('0xmockreleasetxhash123');
    expect(mockSupabaseStore['booking-valid-1'].escrow_status).toBe('released');
  });

  it('prevents concurrent double release through atomic status lock', async () => {
    const p1 = escrowRelease('booking-valid-1');
    const p2 = escrowRelease('booking-valid-1');

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.message).toMatch(/already in progress|already been released/i);
  });

  it('rejects release if booking is not in completed status', async () => {
    mockSupabaseStore['booking-pending'] = {
      id: 'booking-pending',
      customer_id: 'cust-100',
      status: 'in_progress',
      escrow_status: 'deposited',
    };

    await expect(escrowRelease('booking-pending')).rejects.toThrow(
      'Escrow can only be released for completed bookings'
    );
  });

  it('rejects release if escrow_status is not deposited', async () => {
    mockSupabaseStore['booking-released'] = {
      id: 'booking-released',
      customer_id: 'cust-100',
      status: 'completed',
      escrow_status: 'released',
    };

    await expect(escrowRelease('booking-released')).rejects.toThrow(
      'Escrow has already been released for this booking'
    );
  });

  it('rolls back atomic lock to deposited if blockchain transaction fails', async () => {
    mockBlockchainTxWait = vi.fn().mockRejectedValue(new Error('Blockchain RPC timeout'));

    await expect(escrowRelease('booking-valid-1')).rejects.toThrow('Blockchain RPC timeout');

    expect(mockSupabaseStore['booking-valid-1'].escrow_status).toBe('deposited');
  });
});
