import { describe, it, expect, vi, beforeEach } from 'vitest';

const policyMock = vi.hoisted(() => ({
  authorize: vi.fn(),
}));

vi.mock('../../src/security/policyEngine.js', () => ({
  policy: policyMock,
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: null,
}));

const { OrderValidationService, default: defaultService } = await import(
  '../../src/services/order/orderValidationService.js'
);
const { DomainError } = await import('../../src/services/order/domainError.js');

function buildService() {
  return new OrderValidationService({ supabase: null, orderRepository: null, logger: console });
}

describe('OrderValidationService assertions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assertOrderFound throws 404 when the order is missing', () => {
    const svc = buildService();
    expect(() => svc.assertOrderFound(null)).toThrow(DomainError);
  });

  it('assertOrderFound passes when the order exists', () => {
    const svc = buildService();
    expect(() => svc.assertOrderFound({ id: 'o1' })).not.toThrow();
  });

  it('assertOrderStatus throws 409 for a disallowed status', () => {
    const svc = buildService();
    expect(() => svc.assertOrderStatus({ status: 'delivered' }, ['pending'])).toThrow(DomainError);
  });

  it('assertOrderStatus passes for an allowed status', () => {
    const svc = buildService();
    expect(() => svc.assertOrderStatus({ status: 'pending' }, ['pending'])).not.toThrow();
  });

  it('assertNotTerminalStatus throws for terminal statuses', () => {
    const svc = buildService();
    for (const status of ['delivered', 'cancelled', 'payment_released']) {
      expect(() => svc.assertNotTerminalStatus({ status })).toThrow(DomainError);
    }
  });

  it('assertNotTerminalStatus passes for in-progress statuses', () => {
    const svc = buildService();
    expect(() => svc.assertNotTerminalStatus({ status: 'in_transit' })).not.toThrow();
  });

  it('assertEscrowState throws 400 for a disallowed escrow state', () => {
    const svc = buildService();
    expect(() => svc.assertEscrowState({ escrow_status: 'pending' }, ['funded'])).toThrow(DomainError);
  });

  it('assertEscrowState passes for an allowed state', () => {
    const svc = buildService();
    expect(() => svc.assertEscrowState({ escrow_status: 'funded' }, ['funded'])).not.toThrow();
  });

  it('validateOrderForBidAcceptance only accepts pending orders', () => {
    const svc = buildService();
    expect(svc.validateOrderForBidAcceptance({ status: 'pending' })).toBe(true);
    expect(svc.validateOrderForBidAcceptance({ status: 'delivered' })).toBe(false);
    expect(svc.validateOrderForBidAcceptance(null)).toBe(false);
  });

  it('findOrderByIdOrDisplayId strips the TX- prefix before lookup', async () => {
    const repo = {
      findOrderById: vi.fn().mockResolvedValue(null),
      findOrderByDisplayId: vi.fn().mockResolvedValue({ id: 'o1' }),
    };
    const svc = new OrderValidationService({ orderRepository: repo });
    const order = await svc.findOrderByIdOrDisplayId('TX-o1');
    expect(repo.findOrderById).toHaveBeenCalledWith('o1', '*');
    expect(order).toEqual({ id: 'o1' });
  });

  it('default export is a service instance proxy', () => {
    expect(defaultService).toBeDefined();
  });
});
