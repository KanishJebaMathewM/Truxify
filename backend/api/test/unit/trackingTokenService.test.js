import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { TrackingTokenService } from '../../src/services/trackingTokenService.js'

function createMockSupabase(store = {}) {
  const calls = []
  return {
    supabase: {
      from(table) {
        if (!store[table]) store[table] = []
        const builder = {
          _table: table,
          _filters: [],
          _data: null,
          _mode: null,
          eq(col, val) { this._filters.push({ col, val }); return this },
          gt(col, val) { this._filters.push({ col, val, op: 'gt' }); return this },
          lt(col, val) { this._filters.push({ col, val, op: 'lt' }); return this },
          order() { return this },
          limit(n) { this._limit = n; return this },
          single() { this._single = true; return this },
          maybeSingle() { this._maybeSingle = true; return this },
          select(cols) { this._select = cols; return this },
          insert(data) {
            this._mode = 'insert'
            this._data = data
            return this
          },
          update(data) {
            this._mode = 'update'
            this._data = data
            return this
          },
          delete() {
            this._mode = 'delete'
            return this
          },
          async then(resolve, reject) {
            try {
              calls.push({ table: this._table, mode: this._mode, data: this._data, filters: this._filters })

              if (this._mode === 'insert') {
                const row = {
                  id: crypto.randomUUID(),
                  created_at: new Date().toISOString(),
                  revoked: false,
                  ...this._data,
                }
                store[this._table].push(row)
                return resolve({ data: row, error: null })
              }

              if (this._mode === 'update') {
                let rows = store[this._table] || []
                for (const f of this._filters) {
                  rows = rows.filter(r => r[f.col] === f.val)
                }
                for (const row of rows) {
                  Object.assign(row, this._data)
                }
                return resolve({ data: rows[0] || null, error: null })
              }

              if (this._mode === 'delete') {
                const initialLen = (store[this._table] || []).length
                let remaining = store[this._table] || []
                for (const f of this._filters) {
                  if (f.op === 'lt') {
                    remaining = remaining.filter(r => !(r[f.col] < f.val))
                  }
                }
                const deleted = initialLen - remaining.length
                store[this._table] = remaining
                return resolve({ data: Array(deleted).fill({ id: 'deleted' }), error: null })
              }

              // select
              let rows = (store[this._table] || []).slice()
              for (const f of this._filters) {
                if (f.op === 'gt') {
                  rows = rows.filter(r => r[f.col] > f.val)
                } else if (f.op === 'lt') {
                  rows = rows.filter(r => r[f.col] < f.val)
                } else {
                  rows = rows.filter(r => r[f.col] === f.val)
                }
              }
              if (this._maybeSingle) {
                return resolve({ data: rows[0] || null, error: null })
              }
              if (this._single) {
                return resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } })
              }
              return resolve({ data: rows, error: null })
            } catch (err) {
              return reject(err)
            }
          },
        }
        return builder
      },
    },
    store,
    calls,
  }
}

describe('TrackingTokenService', () => {
  let service
  let mockData
  let mockLogger

  beforeEach(() => {
    mockData = createMockSupabase()
    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }
    service = new TrackingTokenService({
      supabase: mockData.supabase,
      supabaseAdmin: mockData.supabase,
      logger: mockLogger,
    })
  })

  describe('initialization with null/invalid config', () => {
    it('initializes gracefully when dependencies are omitted and defaults logger', () => {
      const unconfigured = new TrackingTokenService({})
      expect(unconfigured).toBeInstanceOf(TrackingTokenService)
      expect(unconfigured._supabase).toBeUndefined()
      expect(unconfigured._supabaseAdmin).toBeUndefined()
      expect(unconfigured._logger).toBeDefined()
    })

    it('throws when validateToken is called without supabaseAdmin service-role client', async () => {
      const noAdminService = new TrackingTokenService({
        supabase: mockData.supabase,
        logger: mockLogger,
      })
      await expect(noAdminService.validateToken('sample-token')).rejects.toThrow(
        'Service-role client required for tracking token validation'
      )
      expect(mockLogger.error).toHaveBeenCalledWith('validateToken requires service-role client')
    })

    it('throws when getOrderForPublicTracking is called without supabaseAdmin', async () => {
      const noAdminService = new TrackingTokenService({
        supabase: mockData.supabase,
        logger: mockLogger,
      })
      await expect(noAdminService.getOrderForPublicTracking('#ORD-123')).rejects.toThrow(
        'Service-role client required for public tracking order'
      )
    })

    it('throws when getOrderRouteCoords is called without supabaseAdmin', async () => {
      const noAdminService = new TrackingTokenService({
        supabase: mockData.supabase,
        logger: mockLogger,
      })
      await expect(noAdminService.getOrderRouteCoords('#ORD-123')).rejects.toThrow(
        'Service-role client required for order route coordinates'
      )
    })

    it('throws when getOrderTimeline is called without supabaseAdmin', async () => {
      const noAdminService = new TrackingTokenService({
        supabase: mockData.supabase,
        logger: mockLogger,
      })
      await expect(noAdminService.getOrderTimeline('#ORD-123')).rejects.toThrow(
        'Service-role client required for public tracking timeline'
      )
    })

    it('throws when getDriverLocation is called without supabaseAdmin', async () => {
      const noAdminService = new TrackingTokenService({
        supabase: mockData.supabase,
        logger: mockLogger,
      })
      await expect(noAdminService.getDriverLocation('#ORD-123')).rejects.toThrow(
        'Service-role client required for driver location tracking'
      )
    })
  })

  describe('token generation', () => {
    it('generates a non-empty string token', () => {
      const token = service.generateRawToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('matches expected base64url format and correct length for 32 random bytes', () => {
      const token = service.generateRawToken()
      // 32 bytes encoded in base64url produces 43 characters
      expect(token).toHaveLength(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(token).not.toMatch(/=/)
    })

    it('generates unique, cryptographically random tokens across multiple calls', () => {
      const tokenSet = new Set()
      const iterations = 50
      for (let i = 0; i < iterations; i++) {
        tokenSet.add(service.generateRawToken())
      }
      expect(tokenSet.size).toBe(iterations)
    })
  })

  describe('token hashing and expiry calculation', () => {
    it('produces a deterministic 64-character SHA-256 hex hash', () => {
      const rawToken = 'test-token-xyz'
      const hash1 = service.hashToken(rawToken)
      const hash2 = service.hashToken(rawToken)
      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('returns empty string when hashToken is called with null or non-string input', () => {
      expect(service.hashToken(null)).toBe('')
      expect(service.hashToken(undefined)).toBe('')
      expect(service.hashToken(123)).toBe('')
    })

    it('calculates expiry date approximately 7 days in the future', () => {
      const expiry = new Date(service.getExpiryDate())
      const now = new Date()
      const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      expect(diffDays).toBeGreaterThan(6.9)
      expect(diffDays).toBeLessThanOrEqual(7.0)
    })
  })

  describe('createToken', () => {
    it('creates a token in the database and returns raw token with metadata', async () => {
      const created = await service.createToken({
        orderDisplayId: '#TRX-1001',
        createdBy: 'user-auth-123',
      })

      expect(created.token).toBeDefined()
      expect(created.order_display_id).toBe('#TRX-1001')
      expect(created.expires_at).toBeDefined()
      expect(created.id).toBeDefined()

      const stored = mockData.store.tracking_tokens[0]
      expect(stored.token_hash).toBe(service.hashToken(created.token))
      expect(stored.token).toBeUndefined()
    })

    it('throws error when orderDisplayId is missing', async () => {
      await expect(service.createToken({ createdBy: 'user-1' })).rejects.toThrow(
        'orderDisplayId is required'
      )
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('token validation', () => {
    it('valid token returns valid: true with orderDisplayId and tokenId', async () => {
      const created = await service.createToken({
        orderDisplayId: '#TRX-2002',
        createdBy: 'user-456',
      })

      const validation = await service.validateToken(created.token)
      expect(validation.valid).toBe(true)
      expect(validation.orderDisplayId).toBe('#TRX-2002')
      expect(validation.tokenId).toBe(created.id)
    })

    it('invalid or unknown token returns valid: false with reason not_found', async () => {
      const validation = await service.validateToken('unknown-token-string')
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('not_found')
    })

    it('null or undefined token returns valid: false with reason invalid_token', async () => {
      const validationNull = await service.validateToken(null)
      expect(validationNull.valid).toBe(false)
      expect(validationNull.reason).toBe('invalid_token')

      const validationUndef = await service.validateToken(undefined)
      expect(validationUndef.valid).toBe(false)
      expect(validationUndef.reason).toBe('invalid_token')
    })

    it('expired token returns valid: false with reason expired', async () => {
      const created = await service.createToken({
        orderDisplayId: '#TRX-EXPIRED',
        createdBy: 'user-789',
      })

      // Backdate expires_at to past
      mockData.store.tracking_tokens[0].expires_at = new Date(Date.now() - 60000).toISOString()

      const validation = await service.validateToken(created.token)
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('expired')
      expect(validation.tokenId).toBe(created.id)
    })

    it('revoked token returns valid: false with reason revoked', async () => {
      const created = await service.createToken({
        orderDisplayId: '#TRX-REVOKED',
        createdBy: 'user-789',
      })

      await service.revokeToken(created.id)

      const validation = await service.validateToken(created.token)
      expect(validation.valid).toBe(false)
      expect(validation.reason).toBe('revoked')
    })
  })

  describe('token revocation and purging', () => {
    it('revokes a specific token by tokenId', async () => {
      const created = await service.createToken({
        orderDisplayId: '#TRX-3003',
        createdBy: 'user-111',
      })

      await service.revokeToken(created.id)
      const stored = mockData.store.tracking_tokens.find(t => t.id === created.id)
      expect(stored.revoked).toBe(true)
      expect(stored.revoked_at).toBeDefined()
    })

    it('revokes all active tokens for a specific order', async () => {
      await service.createToken({ orderDisplayId: '#TRX-BULK', createdBy: 'u1' })
      await service.createToken({ orderDisplayId: '#TRX-BULK', createdBy: 'u1' })
      await service.createToken({ orderDisplayId: '#TRX-OTHER', createdBy: 'u2' })

      await service.revokeAllForOrder('#TRX-BULK')

      const bulkTokens = mockData.store.tracking_tokens.filter(t => t.order_display_id === '#TRX-BULK')
      expect(bulkTokens.every(t => t.revoked)).toBe(true)

      const otherTokens = mockData.store.tracking_tokens.filter(t => t.order_display_id === '#TRX-OTHER')
      expect(otherTokens.some(t => !t.revoked)).toBe(true)
    })

    it('purges expired tokens from the database', async () => {
      await service.createToken({ orderDisplayId: '#T1', createdBy: 'u1' })
      await service.createToken({ orderDisplayId: '#T2', createdBy: 'u1' })

      // Set one token to expired
      mockData.store.tracking_tokens[0].expires_at = new Date(Date.now() - 100000).toISOString()

      const purgedCount = await service.purgeExpiredTokens()
      expect(purgedCount).toBe(1)
      expect(mockData.store.tracking_tokens).toHaveLength(1)
    })

    it('retrieves active unrevoked tokens for an order', async () => {
      await service.createToken({ orderDisplayId: '#TRX-ACTIVE', createdBy: 'u1' })
      await service.createToken({ orderDisplayId: '#TRX-ACTIVE', createdBy: 'u1' })

      const active = await service.getActiveTokensForOrder('#TRX-ACTIVE')
      expect(active).toHaveLength(2)
    })
  })

  describe('public tracking order details', () => {
    beforeEach(() => {
      mockData.store.orders = []
      mockData.store.order_timeline = []
      mockData.store.driver_locations = []
    })

    it('fetches public order tracking details by orderDisplayId', async () => {
      mockData.store.orders.push({
        order_display_id: '#TRX-PUBLIC',
        status: 'in_transit',
        pickup_address: 'Warehouse A',
        drop_address: 'Warehouse B',
      })

      const order = await service.getOrderForPublicTracking('#TRX-PUBLIC')
      expect(order).not.toBeNull()
      expect(order.order_display_id).toBe('#TRX-PUBLIC')
      expect(order.status).toBe('in_transit')
    })

    it('returns null when public tracking order does not exist', async () => {
      const order = await service.getOrderForPublicTracking('#NONEXISTENT')
      expect(order).toBeNull()
    })

    it('fetches route coordinates for an order', async () => {
      mockData.store.orders.push({
        order_display_id: '#TRX-ROUTE',
        pickup_lat: 19.076,
        pickup_lng: 72.877,
        drop_lat: 28.613,
        drop_lng: 77.209,
        driver_id: 'd1',
      })

      const coords = await service.getOrderRouteCoords('#TRX-ROUTE')
      expect(coords).not.toBeNull()
      expect(coords.pickup_lat).toBe(19.076)
      expect(coords.drop_lat).toBe(28.613)
    })

    it('fetches order timeline milestones sorted by sort_order', async () => {
      mockData.store.order_timeline.push({
        order_display_id: '#TRX-TL',
        milestone: 'Order Placed',
        sort_order: 1,
        completed: true,
      })
      mockData.store.order_timeline.push({
        order_display_id: '#TRX-TL',
        milestone: 'Driver Assigned',
        sort_order: 2,
        completed: false,
      })

      const timeline = await service.getOrderTimeline('#TRX-TL')
      expect(timeline).toHaveLength(2)
      expect(timeline[0].milestone).toBe('Order Placed')
    })

    it('fetches latest active driver location for an order', async () => {
      mockData.store.orders.push({
        order_display_id: '#TRX-LOC',
        driver_id: 'drv-99',
      })
      mockData.store.driver_locations.push({
        driver_id: 'drv-99',
        latitude: 26.912,
        longitude: 75.787,
        last_updated_at: new Date().toISOString(),
        is_active: true,
      })

      const loc = await service.getDriverLocation('#TRX-LOC')
      expect(loc).not.toBeNull()
      expect(loc.latitude).toBe(26.912)
      expect(loc.longitude).toBe(75.787)
    })
  })
})
