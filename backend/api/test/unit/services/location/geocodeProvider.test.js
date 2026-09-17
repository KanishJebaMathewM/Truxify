import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDriverLocation, resolveMultipleLocations } from '../../../../../src/services/location/geocodeProvider.js';
import * as reverseGeocodeLib from '../../../../../src/lib/reverseGeocode.js';
import logger from '../../../../../src/middleware/logger.js';

vi.mock('../../../../../src/lib/reverseGeocode.js', () => ({
  fetchAddressFromCoords: vi.fn(),
  getReverseGeocode: vi.fn(),
}));

vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
}));

describe('Geocode Provider Enterprise Interface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveDriverLocation (Single Resolve)', () => {
    it('returns formatted address payload and tracks latency when successfully resolved', async () => {
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords').mockResolvedValue('Bandra West, Mumbai');
      const result = await resolveDriverLocation(19.0596, 72.8295);
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('formattedAddress', 'Bandra West, Mumbai');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('latency');
      expect(typeof result.latency).toBe('number');
    });

    it('returns standardized error payload and logs warning when resolution returns null', async () => {
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords').mockResolvedValue(null);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      
      const result = await resolveDriverLocation(0, 0);
      
      expect(result).toHaveProperty('error', 'Location resolution failed');
      expect(result).toHaveProperty('latency');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 0, lon: 0 }),
        expect.stringContaining('[GeocodeProvider] Address resolution returned null')
      );
      warnSpy.mockRestore();
    });

    it('catches and logs unexpected exceptions from the underlying lib', async () => {
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords').mockRejectedValue(new Error('Connection timeout'));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      
      const result = await resolveDriverLocation(10, 10);
      
      expect(result).toHaveProperty('error', 'Location resolution failed');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error resolving location: Connection timeout')
      );
      errorSpy.mockRestore();
    });
  });
  describe('resolveMultipleLocations (Bulk Resolve)', () => {
    it('returns an empty success payload when provided an empty array', async () => {
      const result = await resolveMultipleLocations([]);
      expect(result).toEqual({ success: true, results: [], errors: 0 });
    });

    it('returns an empty success payload when provided null instead of array', async () => {
      const result = await resolveMultipleLocations(null);
      expect(result).toEqual({ success: true, results: [], errors: 0 });
    });

    it('processes an array of valid coordinates and tracks total successes', async () => {
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords').mockResolvedValue('Connaught Place, Delhi');
      
      const coords = [
        { lat: 28.63, lon: 77.22 },
        { lat: 28.64, lon: 77.23 },
        { lat: 28.65, lon: 77.24 }
      ];
      
      const result = await resolveMultipleLocations(coords);
      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
      expect(result.successfulCount).toBe(3);
      expect(result.errors).toBe(0);
      expect(result.results).toHaveLength(3);
    });

    it('handles partial failures robustly in a bulk request', async () => {
      // First succeeds, second returns null, third throws
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords')
        .mockResolvedValueOnce('Valid Location')
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('API crash'));
        
      const coords = [
        { lat: 10, lon: 10 },
        { lat: 20, lon: 20 },
        { lat: 30, lon: 30 }
      ];
      
      const result = await resolveMultipleLocations(coords);
      expect(result.total).toBe(3);
      expect(result.successfulCount).toBe(1);
      expect(result.errors).toBe(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].error).toBe('Location resolution failed');
      expect(result.results[2].error).toBe('Location resolution failed');
    });

    it('handles invalid coordinate objects safely in bulk requests', async () => {
      const coords = [
        null,
        { lat: undefined, lon: 10 },
        { lat: 10 } // missing lon
      ];
      
      const result = await resolveMultipleLocations(coords);
      expect(result.total).toBe(3);
      expect(result.successfulCount).toBe(0);
      expect(result.errors).toBe(3);
      expect(result.results[0].error).toBe('Invalid coordinates');
    });
  });

  describe('Enterprise Utilities & Validation (Extra Coverage)', () => {
    it('rejects completely out-of-bounds coordinates early before external API calls', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await resolveDriverLocation(95, 200); // Invalid coordinates
      
      expect(result).toHaveProperty('error', 'Invalid coordinates provided');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 95, lon: 200 }),
        expect.stringContaining('[GeocodeProvider] Invalid coordinates rejected early')
      );
      warnSpy.mockRestore();
    });

    it('handles boundary string edge cases effectively', async () => {
      // Valid coordinate passed as string
      vi.spyOn(reverseGeocodeLib, 'fetchAddressFromCoords').mockResolvedValue('Valid String Coords');
      const result = await resolveDriverLocation('28.6139', '77.2090');
      expect(result.success).toBe(true);
    });
  });
});

