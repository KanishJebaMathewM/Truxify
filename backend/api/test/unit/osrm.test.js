import { describe, it, expect, vi, beforeEach } from 'vitest';
import { osrmService } from '../../../src/services/osrm.js';

// Mock axios or HTTP client used by the OSRM service
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('OsrmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Route Calculation', () => {
    it('should calculate route successfully with valid coordinates', async () => {
      const mockRouteResponse = {
        data: {
          code: 'Ok',
          routes: [
            {
              distance: 1500,
              duration: 300,
              geometry: 'encoded_polyline_xyz',
            },
          ],
        },
      };

      axios.get.mockResolvedValueOnce(mockRouteResponse);

      const coords = [[13.0827, 80.2707], [13.0878, 80.2785]];
      const result = await osrmService.calculateRoute(coords);

      expect(result).toBeDefined();
      expect(result.distance).toBe(1500);
      expect(result.duration).toBe(300);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should guard against empty or invalid coordinates and throw an error', async () => {
      await expect(osrmService.calculateRoute([])).rejects.toThrow();
      await expect(osrmService.calculateRoute(null)).rejects.toThrow();
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('Timeout and Error Handling', () => {
    it('should handle request timeouts gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'));

      const coords = [[13.0827, 80.2707], [13.0878, 80.2785]];
      await expect(osrmService.calculateRoute(coords)).rejects.toThrow(/timeout/i);
    });

    it('should fallback or throw appropriate error when OSRM service is unreachable', async () => {
      axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const coords = [[13.0827, 80.2707], [13.0878, 80.2785]];
      await expect(osrmService.calculateRoute(coords)).rejects.toThrow(/econnrefused/i);
    });
  });
});
