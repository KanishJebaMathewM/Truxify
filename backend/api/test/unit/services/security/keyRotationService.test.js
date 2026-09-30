import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => {
  const store = {
    key_rotations: [],
    key_rotation_audit_log: [],
    key_ownership_transfers: [],
    profiles: [],
  };

  return {
    store,
    from: vi.fn((table) => {
      const builder = {
        _table: table,
        _mode: 'select',
        _filters: [],
        _data: null,
        insert: vi.fn((data) => {
          builder._mode = 'insert';
          builder._data = data;
          return builder;
        }),
        update: vi.fn((data) => {
          builder._mode = 'update';
          builder._data = data;
          return builder;
        }),
        select: vi.fn(() => builder),
        eq: vi.fn((col, val) => {
          builder._filters.push({ col, val });
          return builder;
        }),
        order: vi.fn(() => builder),
        limit: vi.fn((n) => {
          builder._limit = n;
          return builder;
        }),
        single: vi.fn(async () => {
          if (builder._mode === 'insert') {
            const row = Array.isArray(builder._data) ? builder._data[0] : builder._data;
            if (!store[table]) store[table] = [];
            store[table].push(row);
            return { data: row, error: null };
          }
          const row = store[table]?.[0] || null;
          return { data: row, error: row ? null : { message: 'Not found' } };
        }),
        maybeSingle: vi.fn(async () => {
          const row = store[table]?.[0] || null;
          return { data: row, error: null };
        }),
        then: vi.fn((resolve) => {
          if (builder._mode === 'insert') {
            const row = Array.isArray(builder._data) ? builder._data[0] : builder._data;
            if (!store[table]) store[table] = [];
            store[table].push(row);
            return resolve({ data: [row], error: null });
          }
          if (builder._mode === 'update') {
            const row = store[table]?.[0] || null;
            if (row) Object.assign(row, builder._data);
            return resolve({ data: row ? [row] : [], error: null });
          }
          let rows = store[table] || [];
          for (const f of builder._filters) {
            rows = rows.filter((r) => r[f.col] === f.val);
          }
          if (builder._limit) rows = rows.slice(0, builder._limit);
          return resolve({ data: rows, error: null });
        }),
      };
      return builder;
    }),
  };
});

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('@sentry/node', () => ({
  captureException: mockSentry.captureException,
}));

vi.mock('../../../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: mockSupabase,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

import KeyRotationService from '../../../../src/services/security/keyRotationService.js';

describe('KeyRotationService', () => {
  let service;
  let mockKeyManagementService;
  let mockProvider;
  let mockEscrowContract;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.store.key_rotations = [];
    mockSupabase.store.key_rotation_audit_log = [];
    mockSupabase.store.key_ownership_transfers = [];
    mockSupabase.store.profiles = [];

    mockKeyManagementService = {
      validatePrivateKey: vi.fn().mockReturnValue(true),
      generateMasterSecret: vi.fn().mockReturnValue('master-secret-123'),
      encryptPrivateKey: vi.fn().mockResolvedValue({ ciphertext: 'enc-data', iv: 'iv-123', tag: 'tag-123' }),
      storeEncryptedKey: vi.fn().mockResolvedValue('new-key-uuid-999'),
      retrieveEncryptedKey: vi.fn().mockResolvedValue({ key_id: 'current-key-uuid-111' }),
      archiveKey: vi.fn().mockResolvedValue(true),
    };

    mockProvider = {};
    mockEscrowContract = null;

    service = new KeyRotationService({
      keyManagementService: mockKeyManagementService,
      provider: mockProvider,
      escrowContract: mockEscrowContract,
    });
  });

  describe('initiateKeyRotation', () => {
    it('successfully initiates and completes key rotation with valid inputs', async () => {
      const result = await service.initiateKeyRotation(
        'user-uuid-123',
        '0x71C634C2426379671444458cd25907727fb3849A',
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        'scheduled_rotation',
        '192.168.1.100'
      );

      expect(result.status).toBe('success');
      expect(result.message).toBe('Key rotated successfully');
      expect(result.rotationId).toMatch(/^rot_/);

      expect(mockKeyManagementService.validatePrivateKey).toHaveBeenCalledTimes(2);
      expect(mockKeyManagementService.storeNewKey).toBeUndefined(); // handled via encrypt and store
      expect(mockKeyManagementService.encryptPrivateKey).toHaveBeenCalledWith(
        '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        expect.any(String),
        'master-secret-123'
      );
      expect(mockKeyManagementService.storeEncryptedKey).toHaveBeenCalledWith(
        'user-uuid-123',
        '0x71C634C2426379671444458cd25907727fb3849A',
        expect.any(Object),
        expect.any(String),
        2
      );
      expect(mockKeyManagementService.archiveKey).toHaveBeenCalledWith(
        'current-key-uuid-111',
        'rotation_reason_scheduled_rotation'
      );

      // Lock should be cleared after completion
      expect(service.rotationLocks.size).toBe(0);

      // Audit log and rotation record created
      expect(mockSupabase.store.key_rotations).toHaveLength(1);
      expect(mockSupabase.store.key_rotations[0].status).toBe('completed');
      expect(mockSupabase.store.key_rotation_audit_log).toHaveLength(1);
      expect(mockSupabase.store.key_rotation_audit_log[0].status).toBe('success');
      expect(mockSupabase.store.key_rotation_audit_log[0].ip_address).toBe('192.168.1.100');
    });

    it('blocks concurrent rotations for the same wallet using rotationLocks', async () => {
      const lockKey = 'user-uuid-123:0x71C634C2426379671444458cd25907727fb3849A';
      service.rotationLocks.add(lockKey);

      await expect(
        service.initiateKeyRotation(
          'user-uuid-123',
          '0x71C634C2426379671444458cd25907727fb3849A',
          '0xvalid1',
          '0xvalid2'
        )
      ).rejects.toThrow('Key rotation already in progress');

      expect(mockKeyManagementService.validatePrivateKey).not.toHaveBeenCalled();
    });

    it('rejects invalid current private key format and releases lock', async () => {
      mockKeyManagementService.validatePrivateKey.mockReturnValueOnce(false);

      await expect(
        service.initiateKeyRotation(
          'user-123',
          '0xWallet',
          '0xinvalid',
          '0xvalid'
        )
      ).rejects.toThrow('Invalid private key format');

      expect(service.rotationLocks.has('user-123:0xWallet')).toBe(false);
      expect(mockSentry.captureException).toHaveBeenCalled();
      expect(mockSupabase.store.key_rotation_audit_log[0].status).toBe('failed');
    });

    it('rejects invalid new private key format and releases lock', async () => {
      mockKeyManagementService.validatePrivateKey
        .mockReturnValueOnce(true) // current key valid
        .mockReturnValueOnce(false); // new key invalid

      await expect(
        service.initiateKeyRotation(
          'user-123',
          '0xWallet',
          '0xvalid',
          '0xinvalid'
        )
      ).rejects.toThrow('Invalid private key format');

      expect(service.rotationLocks.has('user-123:0xWallet')).toBe(false);
      expect(mockSentry.captureException).toHaveBeenCalled();
    });

    it('cleans up lock and records failure when storeNewKey fails', async () => {
      mockKeyManagementService.encryptPrivateKey.mockRejectedValue(new Error('KMS encryption timeout'));

      await expect(
        service.initiateKeyRotation(
          'user-123',
          '0xWallet',
          '0xvalid1',
          '0xvalid2'
        )
      ).rejects.toThrow('KMS encryption timeout');

      expect(service.rotationLocks.has('user-123:0xWallet')).toBe(false);
      expect(mockSentry.captureException).toHaveBeenCalled();
      expect(mockSupabase.store.key_rotation_audit_log[0].status).toBe('failed');
      expect(mockSupabase.store.key_rotation_audit_log[0].error_message).toContain('KMS encryption timeout');
    });
  });

  describe('Record management and history', () => {
    it('creates and updates rotation records in database', async () => {
      const rotationId = await service.createRotationRecord('user-1', '0xWallet', 'security_audit');
      expect(rotationId).toMatch(/^rot_/);
      expect(mockSupabase.store.key_rotations[0].reason).toBe('security_audit');
      expect(mockSupabase.store.key_rotations[0].status).toBe('in_progress');

      await service.updateRotationRecord(rotationId, { status: 'completed', new_key_id: 'key-99' });
      expect(mockSupabase.store.key_rotations[0].status).toBe('completed');
      expect(mockSupabase.store.key_rotations[0].new_key_id).toBe('key-99');
    });

    it('fetches rotation history for a user and wallet address', async () => {
      mockSupabase.store.key_rotations = [
        { rotation_id: 'rot_1', user_id: 'user-1', wallet_address: '0xWallet', initiated_at: '2026-01-01T00:00:00Z' },
        { rotation_id: 'rot_2', user_id: 'user-1', wallet_address: '0xWallet', initiated_at: '2026-02-01T00:00:00Z' },
      ];

      const history = await service.getRotationHistory('user-1', '0xWallet', 5);
      expect(history).toHaveLength(2);
    });
  });

  describe('transferKeyOwnershipOnChain', () => {
    it('skips transfer gracefully when escrow contract is unavailable', async () => {
      const result = await service.transferKeyOwnershipOnChain(
        'user-1',
        '0xWallet',
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
      );

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('contract_unavailable');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Escrow contract not available')
      );
    });
  });

  describe('enforceKeyRotationPolicy', () => {
    it('returns requiresRotation: false when user has no polygon wallet address', async () => {
      mockSupabase.store.profiles = [];
      const check = await service.enforceKeyRotationPolicy('user-no-wallet');
      expect(check.requiresRotation).toBe(false);
    });

    it('returns requiresRotation: true when wallet has no prior rotation history', async () => {
      mockSupabase.store.profiles = [{ polygon_wallet_address: '0xWallet123', id: 'user-1' }];
      mockSupabase.store.key_rotations = [];

      const check = await service.enforceKeyRotationPolicy('user-1');
      expect(check.requiresRotation).toBe(true);
      expect(check.reason).toBe('no_rotation_history');
      expect(check.walletAddress).toBe('0xWallet123');
    });

    it('returns requiresRotation: true when last rotation exceeds threshold days', async () => {
      mockSupabase.store.profiles = [{ polygon_wallet_address: '0xWallet123', id: 'user-1' }];
      // 100 days ago
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      mockSupabase.store.key_rotations = [
        { user_id: 'user-1', wallet_address: '0xWallet123', initiated_at: oldDate },
      ];

      const check = await service.enforceKeyRotationPolicy('user-1', 90);
      expect(check.requiresRotation).toBe(true);
      expect(check.reason).toBe('policy_expired');
      expect(check.daysSinceRotation).toBeGreaterThan(90);
    });

    it('returns requiresRotation: false when last rotation is within threshold', async () => {
      mockSupabase.store.profiles = [{ polygon_wallet_address: '0xWallet123', id: 'user-1' }];
      // 10 days ago
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      mockSupabase.store.key_rotations = [
        { user_id: 'user-1', wallet_address: '0xWallet123', initiated_at: recentDate },
      ];

      const check = await service.enforceKeyRotationPolicy('user-1', 90);
      expect(check.requiresRotation).toBe(false);
    });
  });
});
