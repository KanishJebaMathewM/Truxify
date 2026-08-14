import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../src/validation/requestSchemas.js', () => ({
  reportGripDataSchema: {
    safeParse: vi.fn(),
  },
}));

const { reportGripDataSchema } = await import('../../../src/validation/requestSchemas.js');

function buildSupabaseAdminMock() {
  const chain = {
    insert: vi.fn(() => Promise.resolve({ error: null })),
    select: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return chain;
}

vi.mock('../../../src/config/db.js', () => ({
  supabaseAdmin: buildSupabaseAdminMock(),
  supabase: null,
}));

const { reportGripData, getNearbyGripData } = await import('../../../src/controllers/roadConditionController.js');
const supabaseAdmin = (await import('../../../src/config/db.js')).supabaseAdmin;

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('roadConditionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportGripDataSchema.safeParse.mockReturnValue({
      success: true,
      data: {
        latitude: 12.9,
        longitude: 77.5,
        grip_index: 0.8,
        slip_events_count: 2,
      },
    });
  });

  describe('reportGripData', () => {
    it('rejects an invalid payload with 400', async () => {
      reportGripDataSchema.safeParse.mockReturnValue({ success: false, error: {} });
      const req = { body: {} };
      const res = mockRes();

      await reportGripData(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('inserts a grip report and returns 201', async () => {
      supabaseAdmin.from = vi.fn(() => supabaseAdmin);
      supabaseAdmin.insert.mockResolvedValue({ error: null });

      const req = { body: { latitude: 12.9, longitude: 77.5, grip_index: 0.8, slip_events_count: 2 }, user: { id: 'u1' } };
      const res = mockRes();

      await reportGripData(req, res);

      expect(supabaseAdmin.insert).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 12.9, grip_index: 0.8, user_id: 'u1' }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 500 on insert error', async () => {
      supabaseAdmin.from = vi.fn(() => supabaseAdmin);
      supabaseAdmin.insert.mockResolvedValue({ error: { message: 'db down' } });

      await reportGripData({ body: { latitude: 1, longitude: 2, grip_index: 0.5, slip_events_count: 0 }, user: {} }, mockRes());
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getNearbyGripData', () => {
    it('rejects missing coordinates with 400', async () => {
      const res = mockRes();
      await getNearbyGripData({ query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects out-of-range latitude with 400', async () => {
      const res = mockRes();
      await getNearbyGripData({ query: { lat: 95, lng: 77 } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects invalid radius with 400', async () => {
      const res = mockRes();
      await getNearbyGripData({ query: { lat: 12, lng: 77, radius_miles: -5 } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

     it('returns nearby grip data', async () => {
      supabaseAdmin.from = vi.fn(() => supabaseAdmin);
      supabaseAdmin.limit.mockResolvedValue({ data: [{ id: 'r1' }], error: null });

      const req = { query: { lat: '12.9', lng: '77.5', radius_miles: '50' } };
      const res = mockRes();

      await getNearbyGripData(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'r1' }] });
    });

    it('clamps the latitude bounding box to the valid range near the poles', async () => {
      supabaseAdmin.from = vi.fn(() => supabaseAdmin);
      supabaseAdmin.limit.mockResolvedValue({ data: [], error: null });

      const req = { query: { lat: '89.9', lng: '0', radius_miles: '1000' } };
      const res = mockRes();

      await getNearbyGripData(req, res);

      // The two latitude filters must be within [-90, 90].
      const gteCalls = supabaseAdmin.gte.mock.calls;
      const lteCalls = supabaseAdmin.lte.mock.calls;
      const latGte = gteCalls.find(c => c[0] === 'latitude');
      const latLte = lteCalls.find(c => c[0] === 'latitude');
      expect(latGte[1]).toBeGreaterThanOrEqual(-90);
      expect(latLte[1]).toBeLessThanOrEqual(90);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });
});
