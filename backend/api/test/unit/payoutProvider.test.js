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

  beforeEach(() => {
    delete process.env.WITHDRAWAL_PAYOUT_PROVIDER
    delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
  })

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.WITHDRAWAL_PAYOUT_PROVIDER
    else process.env.WITHDRAWAL_PAYOUT_PROVIDER = originalProvider
    if (originalWebhook === undefined) delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL
    else process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL = originalWebhook
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
})
