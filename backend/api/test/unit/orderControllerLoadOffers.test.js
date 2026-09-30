import { describe, it, expect, vi, beforeEach } from 'vitest';

const range = vi.fn();

vi.mock('../../src/config/db.js', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: (...args) => range(...args),
  };
  return { supabase: { from: () => query }, mongoDb: null, supabaseAdmin: null, redisClient: null };
});

// Load the DI container first, as src/index.js does; orderValidationService and
// the container import each other.
await import('../../src/core/container.js');
const { getLoadOffers, getEnRouteLoads } = await import('../../src/controllers/orderController.js');
const { AppError } = await import('../../src/utils/errors.js');

function res() {
  return { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
}

describe('orderController load offer listing', () => {
  beforeEach(() => {
    range.mockReset();
  });

  it('returns the requested page of offers', async () => {
    range.mockResolvedValue({ data: [{ id: 'o1' }], error: null });
    const response = res();

    await getLoadOffers({ query: { page: '2', limit: '10' } }, response, vi.fn());

    expect(range).toHaveBeenCalledWith(10, 19);
    expect(response.json).toHaveBeenCalledWith([{ id: 'o1' }]);
  });

  it('passes a database error on as a 500 AppError without leaking its message', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'relation "load_offers" does not exist' } });
    const next = vi.fn();

    await getEnRouteLoads({ query: {} }, res(), next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Failed to fetch en-route loads.');
    expect(JSON.stringify(err.details)).not.toContain('load_offers');
  });

  it('passes a thrown error on as a 500 AppError', async () => {
    range.mockRejectedValue(new Error('network'));
    const next = vi.fn();

    await getLoadOffers({ query: {} }, res(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });
});
