import { describe, it, expect, vi } from 'vitest'
import { getRoot, notFound } from '../../src/controllers/rootController.js'

describe('rootController', () => {
  it('getRoot returns an HTML status page including the websocket URL', () => {
    const res = { send: vi.fn() }
    getRoot({ hostname: 'api.example.com' }, res)
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('ws://api.example.com'))
  })

  it('getRoot defaults the port from the PORT environment variable', () => {
    const original = process.env.PORT
    process.env.PORT = '8080'
    const res = { send: vi.fn() }
    getRoot({ hostname: 'localhost' }, res)
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining(':8080/ws/tracking'))
    if (original === undefined) delete process.env.PORT
    else process.env.PORT = original
  })

  it('notFound returns a 404 JSON error', () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    notFound({}, res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Endpoint resource not found.' })
  })
})
