import { describe, it, expect, vi } from 'vitest'

const sio = vi.hoisted(() => {
  const mkNS = () => ({ use: vi.fn(), on: vi.fn() })
  const instance = {
    ns: new Map(),
    close: vi.fn(),
    disconnectSockets: vi.fn(),
    of(name) {
      if (!this.ns.has(name)) this.ns.set(name, mkNS())
      return this.ns.get(name)
    },
  }
  return {
    Server: function MockServer() { return instance },
    instance,
  }
})

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('socket.io', () => ({ Server: sio.Server }))
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(), sign: vi.fn() } }))
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }))
vi.mock('../../src/models/GpsLog.js', () => ({ GpsLog: { create: vi.fn() } }))
vi.mock('../../src/config/db.js', () => ({ supabase: {} }))

const {
  initLocationServer,
  closeLocationServer,
  getActiveDriverCount,
} = await import('../../src/sockets/locationServer.js')

function fakeSocket() {
  return {
    id: 'sock-1',
    data: { driverId: 'd1', bookingId: 'b1' },
    join: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }
}

function getDriverConnectionHandler() {
  const ns = sio.instance.ns.get('/driver')
  const call = ns.on.mock.calls.find(([event]) => event === 'connection')
  return call?.[1]
}

describe('locationServer', () => {
  it('starts with no active drivers', () => {
    expect(getActiveDriverCount()).toBe(0)
  })

  it('registers the driver and customer namespaces on init', () => {
    initLocationServer({})
    expect(sio.instance.ns.has('/driver')).toBe(true)
  })

  it('increments active driver count on connection and resets on close', async () => {
    const handler = getDriverConnectionHandler()
    expect(handler).toBeInstanceOf(Function)

    handler(fakeSocket())
    expect(getActiveDriverCount()).toBe(1)

    await closeLocationServer()
    expect(getActiveDriverCount()).toBe(0)
  })
})
