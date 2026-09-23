import { describe, it, expect, vi } from 'vitest'

const mongooseMock = vi.hoisted(() => {
  return {
    models: {},
    Schema: class {
      constructor(fields, opts) {
        this.fields = fields
        this.opts = opts
      }
    },
    model(name, schema) {
      if (mongooseMock.models[name]) return mongooseMock.models[name]
      const Model = function (values = {}) {
        for (const [key, def] of Object.entries(schema.fields)) {
          this[key] =
            values[key] !== undefined
              ? values[key]
              : def.default !== undefined
                ? def.default
                : null
        }
      }
      Model.prototype.validate = function () {
        return Promise.resolve().then(() => {
          for (const [key, def] of Object.entries(schema.fields)) {
            const val = this[key]
            if (def.required && (val === undefined || val === null || val === '')) {
              throw new Error(`${key} is required`)
            }
            if (def.min != null && val != null && val < def.min) {
              throw new Error(`${key} below minimum`)
            }
            if (def.max != null && val != null && val > def.max) {
              throw new Error(`${key} above maximum`)
            }
          }
        })
      }
      mongooseMock.models[name] = Model
      return Model
    },
  }
})

vi.mock('mongoose', () => ({ default: mongooseMock }))

import GpsLog from '../../src/models/GpsLog.js'

describe('GpsLog model', () => {
  it('accepts a valid telemetry document', async () => {
    const doc = new GpsLog({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      lat: 12.9716,
      lng: 77.5946,
      speed: 42,
      heading: 90,
      timestamp: new Date(),
    })
    await expect(doc.validate()).resolves.toBeUndefined()
  })

  it('requires bookingId and driverId', async () => {
    const doc = new GpsLog({ lat: 0, lng: 0, timestamp: new Date() })
    await expect(doc.validate()).rejects.toThrow(/bookingId|driverId/)
  })

  it('rejects latitude outside -90..90', async () => {
    const doc = new GpsLog({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      lat: 120,
      lng: 0,
      timestamp: new Date(),
    })
    await expect(doc.validate()).rejects.toThrow(/lat/)
  })

  it('rejects longitude outside -180..180', async () => {
    const doc = new GpsLog({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      lat: 0,
      lng: 200,
      timestamp: new Date(),
    })
    await expect(doc.validate()).rejects.toThrow(/lng/)
  })

  it('applies default speed and heading but no metadata field', () => {
    const doc = new GpsLog({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      lat: 0,
      lng: 0,
      timestamp: new Date(),
    })
    expect(doc.speed).toBeNull()
    expect(doc.heading).toBeNull()
    expect(doc.metadata).toBeUndefined()
  })
})