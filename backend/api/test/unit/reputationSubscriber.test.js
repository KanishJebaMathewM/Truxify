import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const awardReputationPoints = vi.fn()
  const insertReputationFailure = vi.fn()
  const subscribe = vi.fn()
  const span = { setStatus: vi.fn(), end: vi.fn() }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return {
    awardReputationPoints,
    insertReputationFailure,
    subscribe,
    span,
    startEventHandlerSpan: vi.fn(() => span),
    recordError: vi.fn(),
    logger,
  }
})

vi.mock('../../src/core/events/index.js', () => ({
  eventBus: { subscribe: mocks.subscribe },
}))
vi.mock('../../src/services/reputation.js', () => ({
  awardReputationPoints: mocks.awardReputationPoints,
}))
vi.mock('../../src/repositories/orderRepository.js', () => ({
  OrderRepository: class {
    constructor() {}
    insertReputationFailure(...args) {
      return mocks.insertReputationFailure(...args)
    }
  },
}))
vi.mock('../../src/config/db.js', () => ({ supabase: {} }))
vi.mock('../../src/middleware/logger.js', () => ({ default: mocks.logger }))
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: { extractFromEventPayload: vi.fn().mockReturnValue({}) },
}))
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startEventHandlerSpan: mocks.startEventHandlerSpan,
    recordError: mocks.recordError,
  },
}))
vi.mock('@opentelemetry/api', () => ({
  context: { active: () => ({}), with: (_ctx, fn) => fn() },
  trace: { setSpan: (ctx) => ctx },
  SpanStatusCode: { OK: 0, ERROR: 1 },
}))

await import('../../src/subscribers/reputationSubscriber.js')

const handler = mocks.subscribe.mock.calls[0][1]

describe('reputationSubscriber', () => {
  beforeEach(() => {
    mocks.awardReputationPoints.mockClear()
    mocks.insertReputationFailure.mockClear()
    mocks.logger.warn.mockClear()
  })

  it('registers a handler for the rating:submitted event', () => {
    expect(mocks.subscribe).toHaveBeenCalledWith('rating:submitted', expect.any(Function))
  })

  it('awards reputation points on a valid rating event', async () => {
    mocks.awardReputationPoints.mockResolvedValue(undefined)
    const h = handler
    await handler({ payload: { driverWallet: '0x1', stars: 5, orderDisplayId: '#o1' } })
    expect(mocks.awardReputationPoints).toHaveBeenCalledWith('0x1', 5)
  })

  it('skips when the driver wallet is missing', async () => {
    const h = handler
    await handler({ payload: { stars: 5, orderDisplayId: '#o1' } })
    expect(mocks.awardReputationPoints).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalled()
  })

  it('logs a reputation failure to the DB when the on-chain update fails', async () => {
    mocks.awardReputationPoints.mockRejectedValue(new Error('chain down'))
    mocks.insertReputationFailure.mockResolvedValue(undefined)
    const h = handler
    await handler({ payload: { driverWallet: '0x1', stars: 4, orderDisplayId: '#o2' } })
    expect(mocks.insertReputationFailure).toHaveBeenCalled()
  })
})
