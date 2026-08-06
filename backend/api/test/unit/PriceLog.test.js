import { describe, it, expect } from 'vitest'
import { PriceLog } from '../../src/models/PriceLog.js'

describe('PriceLog model', () => {
  it('accepts a valid price log document', async () => {
    const doc = new PriceLog({
      order_id: 'order-1',
      predicted_price: 1000,
      accepted_price: 1100,
      distance_km: 45.5,
      weight_tonnes: 3.2,
    })
    await expect(doc.validate()).resolves.toBeUndefined()
  })

  it('requires order_id and both prices', async () => {
    const doc = new PriceLog({ order_id: 'order-1' })
    await expect(doc.validate()).rejects.toThrow(/predicted_price|accepted_price/)
  })

  it('defaults created_at to the current date', () => {
    const doc = new PriceLog({
      order_id: 'order-1',
      predicted_price: 100,
      accepted_price: 100,
    })
    expect(doc.created_at).toBeInstanceOf(Date)
  })
})
