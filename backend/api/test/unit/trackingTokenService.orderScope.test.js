import { describe, expect, it } from 'vitest'
import { TrackingTokenService } from '../../src/services/trackingTokenService.js'

function createMockSupabase(store) {
  const calls = []

  return {
    client: {
      from(table) {
        const builder = {
          _table: table,
          _filters: [],
          _single: false,
          _maybeSingle: false,
          eq(column, value) {
            this._filters.push({ column, value })
            return this
          },
          gte(column, value) {
            this._filters.push({ column, value, op: 'gte' })
            return this
          },
          select() {
            return this
          },
          order() {
            return this
          },
          limit() {
            return this
          },
          single() {
            this._single = true
            return this
          },
          maybeSingle() {
            this._maybeSingle = true
            return this
          },
          then(resolve, reject) {
            try {
              calls.push({
                table: this._table,
                filters: [...this._filters],
              })

              let rows = [...(store[this._table] || [])]
              for (const filter of this._filters) {
                if (filter.op === 'gte') {
                  rows = rows.filter((row) => row[filter.column] >= filter.value)
                } else {
                  rows = rows.filter((row) => row[filter.column] === filter.value)
                }
              }

              if (this._maybeSingle) {
                return resolve({ data: rows[0] || null, error: null })
              }

              if (this._single) {
                return resolve({
                  data: rows[0] || null,
                  error: rows[0] ? null : { message: 'not found' },
                })
              }

              return resolve({ data: rows, error: null })
            } catch (error) {
              return reject(error)
            }
          },
        }

        return builder
      },
    },
    calls,
  }
}

describe('TrackingTokenService public driver-location order scoping', () => {
  it('returns the driver location only when the driver has an active trip for the tracked order', async () => {
    const mockData = createMockSupabase({
      orders: [
        { id: 'order-a-id', order_display_id: '#TRX-A', driver_id: 'driver-1' },
      ],
      trips: [
        { order_id: 'order-a-id', driver_id: 'driver-1', status: 'active' },
      ],
      driver_locations: [
        {
          driver_id: 'driver-1',
          latitude: 26.912,
          longitude: 75.787,
          last_updated_at: new Date().toISOString(),
          is_active: true,
        },
      ],
    })
    const service = new TrackingTokenService({
      supabaseAdmin: mockData.client,
      logger: { error() {} },
    })

    const location = await service.getDriverLocation('#TRX-A')

    expect(location).toMatchObject({
      latitude: 26.912,
      longitude: 75.787,
    })
    expect(mockData.calls.map((call) => call.table)).toEqual([
      'orders',
      'trips',
      'driver_locations',
    ])
  })

  it('does not expose a driver location when the driver has been reassigned to another active trip', async () => {
    const mockData = createMockSupabase({
      orders: [
        { id: 'order-a-id', order_display_id: '#TRX-A', driver_id: 'driver-1' },
      ],
      trips: [
        { order_id: 'order-b-id', driver_id: 'driver-1', status: 'active' },
      ],
      driver_locations: [
        {
          driver_id: 'driver-1',
          latitude: 28.6139,
          longitude: 77.209,
          last_updated_at: new Date().toISOString(),
          is_active: true,
        },
      ],
    })
    const service = new TrackingTokenService({
      supabaseAdmin: mockData.client,
      logger: { error() {} },
    })

    const location = await service.getDriverLocation('#TRX-A')

    expect(location).toBeNull()
    expect(mockData.calls.map((call) => call.table)).toEqual([
      'orders',
      'trips',
    ])
  })

  it('does not expose a driver location when the driver has no active trip', async () => {
    const mockData = createMockSupabase({
      orders: [
        { id: 'order-a-id', order_display_id: '#TRX-A', driver_id: 'driver-1' },
      ],
      trips: [
        { order_id: 'order-a-id', driver_id: 'driver-1', status: 'completed' },
      ],
      driver_locations: [
        {
          driver_id: 'driver-1',
          latitude: 26.912,
          longitude: 75.787,
          last_updated_at: new Date().toISOString(),
          is_active: true,
        },
      ],
    })
    const service = new TrackingTokenService({
      supabaseAdmin: mockData.client,
      logger: { error() {} },
    })

    const location = await service.getDriverLocation('#TRX-A')

    expect(location).toBeNull()
    expect(mockData.calls.map((call) => call.table)).toEqual([
      'orders',
      'trips',
    ])
  })
})
