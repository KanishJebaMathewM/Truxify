import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('swagger-jsdoc', () => ({
  default: vi.fn(() => ({ openapi: '3.0.0', paths: {} })),
}))

vi.mock('swagger-ui-express', () => ({
  default: { serve: 'serve-fn', setup: vi.fn(() => 'setup-fn') },
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { setupSwagger } = await import('../../src/config/swagger.js')

describe('setupSwagger', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('does not mount docs in production', () => {
    process.env.NODE_ENV = 'production'
    const app = { use: vi.fn() }
    setupSwagger(app)
    expect(app.use).not.toHaveBeenCalled()
  })

  it('mounts the docs UI in development', () => {
    process.env.NODE_ENV = 'development'
    const app = { use: vi.fn() }
    setupSwagger(app)
    expect(app.use).toHaveBeenCalledWith('/api/docs', 'serve-fn', 'setup-fn')
  })
})
