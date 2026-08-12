import { describe, it, expect } from 'vitest'
import { GpsLog } from '../../src/models/GpsLog.js'

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

  it('applies default speed, heading and metadata', () => {
    const doc = new GpsLog({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      lat: 0,
      lng: 0,
      timestamp: new Date(),
    })
    expect(doc.speed).toBe(0)
    expect(doc.heading).toBe(0)
    expect(doc.metadata).toEqual({})
  })
})
