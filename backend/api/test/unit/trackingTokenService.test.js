import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { TrackingTokenService } from '../../src/services/trackingTokenService.js';

function createMockSupabase(store = {}) {
  const calls = [];
  return {
    supabase: {
      from(table) {
        if (!store[table]) store[table] = [];
        const builder = {
          _table: table,
          _filters: [],
          _data: null,
          _mode: null,
          eq(col, val) { this._filters.push({ col, val }); return this; },
          gt(col, val) { this._filters.push({ col, val, op: 'gt' }); return this; },
          order() { return this; },
          limit(n) { this._limit = n; return this; },
          single() { this._single = true; return this; },
          select(cols) { this._select = cols; return this; },
          insert(data) {
            this._mode = 'insert';
            this._data = data;
            return this;
          },
          update(data) {
            this._mode = 'update';
            this._data = data;
            return this;
          },
          async then(resolve, reject) {
            try {
              calls.push({ table: this._table, mode: this._mode, data: this._data, filters: this._filters });

              if (this._mode === 'insert') {
                const row = {
                  id: crypto.randomUUID(),
                  created_at: new Date().toISOString(),
                  revoked: false,
                  ...this._data,
                };
                store[this._table].push(row);
                return resolve({ data: row, error: null });
              }

              if (this._mode === 'update') {
                let rows = store[this._table];
                for (const f of this._filters) {
                  rows = rows.filter(r => r[f.col] === f.val);
                }
                for (const row of rows) {
                  Object.assign(row, this._data);
                }
                return resolve({ data: rows[0] || null, error: null });
              }

              // select
              let rows = (store[this._table] || []).slice();
              for (const f of this._filters) {
                if (f.op === 'gt') {
                  rows = rows.filter(r => r[f.col] > f.val);
                } else {
                  rows = rows.filter(r => r[f.col] === f.val);
                }
              }
              if (this._single) {
                return resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } });
              }
              return resolve({ data: rows, error: null });
            } catch (err) {
              return reject(err);
            }
          },
        };
        return builder;
      },
    },
    store,
    calls,
  };
}

describe('TrackingTokenService', () => {
  let service;
  let mockData;

  beforeEach(() => {
    mockData = createMockSupabase();
    service = new TrackingTokenService({
      supabase: mockData.supabase,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
  });

  describe('generateRawToken', () => {
    it('should generate a base64url token', () => {
      const token = service.generateRawToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(token).not.toMatch(/=/); // base64url has no padding
    });

    it('should generate unique tokens', () => {
      const t1 = service.generateRawToken();
      const t2 = service.generateRawToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('hashToken', () => {
    it('should produce a 64-char hex SHA-256 hash', () => {
      const hash = service.hashToken('test-token-123');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const h1 = service.hashToken('abc');
      const h2 = service.hashToken('abc');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different inputs', () => {
      const h1 = service.hashToken('token-a');
      const h2 = service.hashToken('token-b');
      expect(h1).not.toBe(h2);
    });
  });

  describe('getExpiryDate', () => {
    it('should return a date 7 days in the future', () => {
      const expiry = new Date(service.getExpiryDate());
      const now = new Date();
      const diffMs = expiry.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThanOrEqual(7.0);
    });
  });

  describe('createToken', () => {
    it('should insert a token into the database and return it with raw token', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      expect(result.token).toBeDefined();
      expect(result.order_display_id).toBe('#FF20241205');
      expect(result.expires_at).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('should store the hash, not the raw token', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      const storedToken = mockData.store.tracking_tokens[0];
      expect(storedToken.token_hash).toBe(service.hashToken(result.token));
      expect(storedToken.token_hash).not.toBe(result.token);
    });
  });

  describe('validateToken', () => {
    it('should return valid for a known non-expired, non-revoked token', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      const validation = await service.validateToken(result.token);
      expect(validation.valid).toBe(true);
      expect(validation.orderDisplayId).toBe('#FF20241205');
    });

    it('should return not_found for unknown token', async () => {
      const validation = await service.validateToken('nonexistent-token-abc123');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('not_found');
    });

    it('should return revoked for a revoked token', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      await service.revokeToken(mockData.store.tracking_tokens[0].id);

      const validation = await service.validateToken(result.token);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('revoked');
    });

    it('should return expired for an expired token', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      // Manually set expires_at to the past
      mockData.store.tracking_tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();

      const validation = await service.validateToken(result.token);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('expired');
    });
  });

  describe('revokeToken', () => {
    it('should mark a token as revoked', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      await service.revokeToken(mockData.store.tracking_tokens[0].id);

      const stored = mockData.store.tracking_tokens[0];
      expect(stored.revoked).toBe(true);
      expect(stored.revoked_at).toBeDefined();
    });
  });

  describe('revokeAllForOrder', () => {
    it('should revoke all active tokens for an order', async () => {
      await service.createToken({ orderDisplayId: '#FF20241205', createdBy: 'cust-1' });
      await service.createToken({ orderDisplayId: '#FF20241205', createdBy: 'cust-1' });
      await service.createToken({ orderDisplayId: '#FF20241206', createdBy: 'cust-2' });

      await service.revokeAllForOrder('#FF20241205');

      const orderTokens = mockData.store.tracking_tokens.filter(
        t => t.order_display_id === '#FF20241205'
      );
      expect(orderTokens.every(t => t.revoked)).toBe(true);

      const otherTokens = mockData.store.tracking_tokens.filter(
        t => t.order_display_id === '#FF20241206'
      );
      expect(otherTokens.some(t => !t.revoked)).toBe(true);
    });
  });

  describe('security', () => {
    it('should not expose the raw token in the database', async () => {
      const result = await service.createToken({
        orderDisplayId: '#FF20241205',
        createdBy: 'customer-uuid-123',
      });

      const stored = mockData.store.tracking_tokens[0];
      expect(stored.token).toBeUndefined();
      expect(stored.token_hash).toBeDefined();
      expect(stored.token_hash).not.toBe(result.token);
    });

    it('should generate cryptographically random tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(service.generateRawToken());
      }
      expect(tokens.size).toBe(100);
    });
  });
});
