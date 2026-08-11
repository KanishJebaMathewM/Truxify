import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isPayoutProviderConfigured,
  dispatchPayout,
} from '../../src/services/wallet/payoutProvider.js'

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
    await expect(dispatchPayout({ driverId: 'd', withdrawal: { id: 'w' } }))
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

  it('falls back to the generated reference when the webhook omits settlement_ref', async () => {
    process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = 'https://example.com/payout'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const result = await dispatchPayout({ driverId: 'd1', withdrawal: { id: '9', amount: 500 } })
    expect(result.settlementRef).toBe('w9')
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
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
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', mockFetch)

    await expect(dispatchPayout({ driverId: 'd1', withdrawal: { id: 'w1', amount: 1 } }))
      .resolves.toMatchObject({ success: true })
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false)
    vi.unstubAllGlobals()
  })
})
