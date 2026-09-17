import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isPayoutProviderConfigured,
  dispatchPayout,
  getPayoutRecord,
  getPayoutStatus,
  getPayoutById,
  getPayout,
  fetchPayout,
  fetchPayoutRecord,
} from '../../src/services/wallet/payoutProvider.js'

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: null,
  supabaseAdmin: null,
}))

describe('payoutProvider', () => {
  const originalProvider = process.env.WITHDRAWAL_PAYOUT_PROVIDER
  const originalWebhook = process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
  const originalTimeout = process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS

  beforeEach(() => {
    delete process.env.WITHDRAWAL_PAYOUT_PROVIDER
    delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
    delete process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS
  })

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.WITHDRAWAL_PAYOUT_PROVIDER
    else process.env.WITHDRAWAL_PAYOUT_PROVIDER = originalProvider
    if (originalWebhook === undefined) delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
    else process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = originalWebhook
    if (originalTimeout === undefined) delete process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS
    else process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS = originalTimeout
  })

  it('reports not configured when no provider or webhook is set', () => {
    expect(isPayoutProviderConfigured()).toBe(false)
  })

  it('reports configured when a webhook is set', () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    expect(isPayoutProviderConfigured()).toBe(true)
  })

  it('throws when no provider is configured', async () => {
    await expect(dispatchPayout({ driverId: 'd', withdrawal: { id: 'w', amount: 1 } }))
      .rejects.toThrow(/no withdrawal payout provider/i)
  })

  it('dispatches via webhook and returns the settlement reference', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settlement_ref: 'ref-1' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 500 } })
    expect(mockFetch).toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.settlementRef).toBe('ref-1')
    vi.unstubAllGlobals()
  })

  it('fails when the webhook omits settlement_ref', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(dispatchPayout({ driverId: 'd1', withdrawal: { id: '9', amount: 500 } }))
      .rejects.toThrow(/settlement_ref or reference/)
    vi.unstubAllGlobals()
  })

  it('throws when the webhook returns a non-ok response', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 1 } }))
      .rejects.toThrow(/HTTP 500/)
    vi.unstubAllGlobals()
  })

  it('passes an abort signal so a hung webhook cannot stall the worker', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ settlement_ref: 'ref-1' }) })
    vi.stubGlobal('fetch', mockFetch)

    await dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 1 } })

    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    vi.unstubAllGlobals()
  })

  it('surfaces a timeout as a dispatch failure rather than hanging', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS = '25'
    vi.stubGlobal('fetch', vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
    })))

    await expect(dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 1 } }))
      .rejects.toThrow(/did not respond within 25ms/)
    vi.unstubAllGlobals()
  })

  it('ignores a non-positive configured timeout and falls back to the default', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    process.env.WITHDRAWAL_PAYOUT_TIMEOUT_MS = 'not-a-number'
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ settlement_ref: 'ref-1' }) })
    vi.stubGlobal('fetch', mockFetch)

    await expect(dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 1 } }))
      .resolves.toMatchObject({ success: true })
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false)
    vi.unstubAllGlobals()
  })

  describe('Null Guard for Supabase Payout Response', () => {
    it('returns { error: "Payout record not found" } when payoutId is null or missing', async () => {
      const result = await getPayoutRecord(null)
      expect(result).toEqual({ error: 'Payout record not found' })
      expect(result.id).toBeUndefined()
      expect(result.status).toBeUndefined()
    })

    it('returns { error: "Payout record not found" } when database client is unavailable', async () => {
      const result = await getPayoutRecord('payout-123', null)
      expect(result).toEqual({ error: 'Payout record not found' })
    })

    it('returns { error: "Payout record not found" } when maybeSingle() resolves to null data', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }

      const result = await getPayoutRecord('non-existent-id', mockClient)
      expect(result).toEqual({ error: 'Payout record not found' })
      // Verify safe property access without TypeError
      expect(result.id).toBeUndefined()
      expect(result.status).toBeUndefined()
    })

    it('returns { error: "Payout record not found" } when maybeSingle() returns an error', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'PGRST116: JSON object requested, multiple (or no) rows returned' } }),
        }),
      }

      const result = await getPayoutRecord('err-id', mockClient)
      expect(result).toEqual({ error: 'Payout record not found' })
    })

    it('returns { error: "Payout record not found" } when underlying database call throws an exception', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error('Connection closed')),
        }),
      }

      const result = await getPayoutRecord('throw-id', mockClient)
      expect(result).toEqual({ error: 'Payout record not found' })
    })

    it('returns the payout record when successfully found in payouts table', async () => {
      const mockRecord = { id: 'payout-123', status: 'settled', amount: 1500, driver_id: 'driver-99' }
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRecord, error: null }),
        }),
      }

      const result = await getPayoutRecord('payout-123', mockClient)
      expect(result).toEqual(mockRecord)
      expect(result.id).toBe('payout-123')
      expect(result.status).toBe('settled')
    })

    it('falls back to wallet_transactions and returns record when found', async () => {
      const mockTxRecord = { id: 'w-456', status: 'completed', amount: 2000 }
      const mockClient = {
        from: vi.fn()
          .mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
          })
          .mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockTxRecord, error: null }),
          }),
      }

      const result = await getPayoutRecord('w-456', mockClient)
      expect(result).toEqual(mockTxRecord)
      expect(result.id).toBe('w-456')
      expect(result.status).toBe('completed')
    })

    it('getPayoutStatus guards against null and returns structured error', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }

      const result = await getPayoutStatus('missing-id', mockClient)
      expect(result).toEqual({ error: 'Payout record not found' })
      expect(result.status).toBeUndefined()
    })

    it('getPayoutById, getPayout, fetchPayout, fetchPayoutRecord provide consistent null-safe responses', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }

      expect(await getPayoutById('missing', mockClient)).toEqual({ error: 'Payout record not found' })
      expect(await getPayout('missing', mockClient)).toEqual({ error: 'Payout record not found' })
      expect(await fetchPayout('missing', mockClient)).toEqual({ error: 'Payout record not found' })
      expect(await fetchPayoutRecord('missing', mockClient)).toEqual({ error: 'Payout record not found' })
    })
  })
})
