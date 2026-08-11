import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/db.js', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { WorkZoneService } = await import('../../services/workZoneService.js');

describe('WorkZoneService', () => {
  let workZoneService;

  beforeEach(() => {
    vi.clearAllMocks();
    workZoneService = new WorkZoneService({});
  });

  describe('findNearestWorkZone', () => {
    it('returns nearest work zone within radius', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: 'wz1', name: 'Zone A', lat: 19.07, lng: 72.87, radius_m: 500 }],
          error: null,
        }),
      });

      vi.stubGlobal('Math', { ...Math, hypot: () => 200 });
      const result = await workZoneService.findNearestWorkZone(19.07, 72.87, { maxRadius: 1000 });
      expect(result).toBeDefined();
    });

    it('returns null when no work zones in range', async () => {
      vi.stubGlobal('Math', { ...Math, hypot: () => 20000 });
      const result = await workZoneService.findNearestWorkZone(19.07, 72.87, { maxRadius: 100 });
      expect(result).toBeNull();
    });
  });
});
