import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { optimizeWaypoints, getHaversineDistance, optimizeLtlRoute } from '../../../src/services/routingService.js';
import { predictWorkZoneDelays, generateBypassWaypoint } from '../../../src/services/workZoneService.js';

vi.mock('axios');
vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/services/workZoneService.js');

describe('routingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('optimizeWaypoints', () => {
    it('should inject a bypass waypoint if severe delay is predicted', async () => {
      vi.mocked(predictWorkZoneDelays).mockResolvedValue({
        hasSevereDelay: true,
        problematicPoint: { lat: 40, lng: -74 }
      });
      vi.mocked(generateBypassWaypoint).mockReturnValue({
        lat: 40.1, lng: -73.9, address: 'Bypass'
      });

      // Mock OSRM to just return the requested waypoints back in order
      axios.get.mockResolvedValue({
        data: {
          code: 'Ok',
          waypoints: [
            { waypoint_index: 0 },
            { waypoint_index: 1 }, // the original waypoint
            { waypoint_index: 2 }, // the injected bypass waypoint
            { waypoint_index: 3 }, // end
          ]
        }
      });

      const start = { lat: 39, lng: -75 };
      const end = { lat: 41, lng: -73 };
      const waypoints = [{ lat: 40, lng: -74, address: 'Drop1' }];
      
      const optimized = await optimizeWaypoints(start, end, waypoints, '2026-08-07', '09:00');
      
      expect(predictWorkZoneDelays).toHaveBeenCalledWith(
        { lat: 39, lng: -75, address: 'Unknown' },
        { lat: 41, lng: -73, address: 'Unknown' },
        expect.any(Array),
        '2026-08-07',
        '09:00'
      );
      
      expect(generateBypassWaypoint).toHaveBeenCalledWith({ lat: 40, lng: -74 });

      // OSRM result maps waypoint_index 1 and 2 to our effectiveWaypoints
      expect(optimized).toHaveLength(2);
      expect(optimized[1].address).toBe('Bypass');
    });

    it('should not inject a bypass waypoint if no severe delay is predicted', async () => {
      vi.mocked(predictWorkZoneDelays).mockResolvedValue({
        hasSevereDelay: false,
        problematicPoint: null
      });

      axios.get.mockResolvedValue({
        data: {
          code: 'Ok',
          waypoints: [
            { waypoint_index: 0 },
            { waypoint_index: 1 },
            { waypoint_index: 2 },
          ]
        }
      });

      const start = { lat: 39, lng: -75 };
      const end = { lat: 41, lng: -73 };
      const waypoints = [{ lat: 40, lng: -74, address: 'Drop1' }];
      
      const optimized = await optimizeWaypoints(start, end, waypoints, '2026-08-07', '09:00');
      
      expect(predictWorkZoneDelays).toHaveBeenCalled();
      expect(generateBypassWaypoint).not.toHaveBeenCalled();
      
      expect(optimized).toHaveLength(1);
      expect(optimized[0].address).toBe('Drop1');
    });
  });
});
