import crypto from 'crypto';
import logger from '../middleware/logger.js';
import { getHaversineDistance } from './routingService.js';
import { redisClient } from '../config/db.js';

// Constants to simulate commercial work-zone impacts
export const SEVERE_DELAY_THRESHOLD_MINS = 45;
export const DEFAULT_CACHE_TTL_SECONDS = 300; // 5 minutes

export const WORK_ZONE_TYPES = Object.freeze({
  CONSTRUCTION: 'construction',
  ACCIDENT: 'accident',
  CLOSURE: 'closure',
  HAZARD: 'hazard',
  MAINTENANCE: 'maintenance'
});

export const WORK_ZONE_SEVERITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
});

export const WORK_ZONE_STATUS = Object.freeze({
  ACTIVE: 'active',
  SCHEDULED: 'scheduled',
  RESOLVED: 'resolved'
});

// Default initial seeded work zones across major commercial transport routes
const DEFAULT_WORK_ZONES = [
  {
    id: 'WZ-MUM-DEL-01',
    type: WORK_ZONE_TYPES.CONSTRUCTION,
    severity: WORK_ZONE_SEVERITY.HIGH,
    status: WORK_ZONE_STATUS.ACTIVE,
    title: 'NH-48 Highway Widening and Resurfacing',
    description: 'Active lane closure on NH-48 near Surat corridor due to flyover construction.',
    lat: 21.1702,
    lng: 72.8311,
    radiusKm: 5,
    estimatedDelayMins: 50,
    impact: 'LANE_CLOSURE',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-12-31T23:59:59Z'
  },
  {
    id: 'WZ-DEL-AGR-02',
    type: WORK_ZONE_TYPES.ACCIDENT,
    severity: WORK_ZONE_SEVERITY.CRITICAL,
    status: WORK_ZONE_STATUS.ACTIVE,
    title: 'Multi-vehicle collision on Yamuna Expressway',
    description: 'Multi-vehicle commercial pileup blocking 2 lanes; emergency crews on site.',
    lat: 27.5706,
    lng: 77.6744,
    radiusKm: 3,
    estimatedDelayMins: 60,
    impact: 'PARTIAL_BLOCKAGE',
    startTime: '2026-09-17T06:00:00Z',
    endTime: '2026-09-17T18:00:00Z'
  },
  {
    id: 'WZ-BLR-CHE-03',
    type: WORK_ZONE_TYPES.CLOSURE,
    severity: WORK_ZONE_SEVERITY.HIGH,
    status: WORK_ZONE_STATUS.ACTIVE,
    title: 'Vellore Toll Plaza Bridge Rehabilitation',
    description: 'Full directional road closure with bypass detour in effect.',
    lat: 12.9165,
    lng: 79.1325,
    radiusKm: 8,
    estimatedDelayMins: 45,
    impact: 'FULL_CLOSURE',
    startTime: '2026-09-10T00:00:00Z',
    endTime: '2026-09-25T23:59:59Z'
  },
  {
    id: 'WZ-HYD-BLR-04',
    type: WORK_ZONE_TYPES.MAINTENANCE,
    severity: WORK_ZONE_SEVERITY.LOW,
    status: WORK_ZONE_STATUS.ACTIVE,
    title: 'Kurnool Bypass Routine Guardrail Repairs',
    description: 'Shoulder maintenance on NH-44 south of Kurnool.',
    lat: 15.8281,
    lng: 78.0373,
    radiusKm: 2,
    estimatedDelayMins: 15,
    impact: 'SHOULDER_RESTRICTION',
    startTime: '2026-09-15T08:00:00Z',
    endTime: '2026-09-20T17:00:00Z'
  },
  {
    id: 'WZ-PUN-MUM-05',
    type: WORK_ZONE_TYPES.CONSTRUCTION,
    severity: WORK_ZONE_SEVERITY.MEDIUM,
    status: WORK_ZONE_STATUS.SCHEDULED,
    title: 'Mumbai-Pune Expressway Tunnel Light Upgrades',
    description: 'Scheduled night maintenance inside Bhatan Tunnel.',
    lat: 18.8950,
    lng: 73.2100,
    radiusKm: 4,
    estimatedDelayMins: 20,
    impact: 'SPEED_REDUCTION',
    startTime: '2026-11-01T22:00:00Z',
    endTime: '2026-11-05T05:00:00Z'
  }
];

/**
 * Service class handling real-time work zones, geographic queries, alert generation, and predictive routing.
 */
export class WorkZoneService {
  constructor() {
    this.workZones = new Map();
    this.memoryCache = new Map();
    this.cacheStats = { hits: 0, misses: 0 };
    this._initDefaultWorkZones();
  }

  /**
   * Initializes or resets default registered work zones.
   */
  _initDefaultWorkZones() {
    this.workZones.clear();
    for (const wz of DEFAULT_WORK_ZONES) {
      this.workZones.set(wz.id, { ...wz });
    }
  }

  /**
   * Registers or updates a work zone in the in-memory registry.
   * @param {Object} workZone
   * @returns {Object} registered work zone
   */
  registerWorkZone(workZone) {
    if (!workZone || typeof workZone !== 'object') {
      throw new Error('Work zone data is required');
    }
    const lat = Number(workZone.lat);
    const lng = Number(workZone.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Valid lat and lng numbers are required for work zone');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Coordinates out of range (-90..90 lat, -180..180 lng)');
    }

    const id = workZone.id || `WZ-${crypto.randomUUID()}`;
    const entry = {
      id,
      type: workZone.type || WORK_ZONE_TYPES.CONSTRUCTION,
      severity: workZone.severity || WORK_ZONE_SEVERITY.MEDIUM,
      status: workZone.status || WORK_ZONE_STATUS.ACTIVE,
      title: workZone.title || `Work Zone ${id}`,
      description: workZone.description || '',
      lat,
      lng,
      radiusKm: Number(workZone.radiusKm) || 5,
      estimatedDelayMins: Number(workZone.estimatedDelayMins) || 0,
      impact: workZone.impact || 'LANE_RESTRICTION',
      startTime: workZone.startTime || new Date().toISOString(),
      endTime: workZone.endTime || new Date(Date.now() + 86400000).toISOString()
    };

    this.workZones.set(id, entry);
    this.clearMemoryCache();
    return entry;
  }

  /**
   * Unregisters a work zone by ID.
   * @param {string} id
   * @returns {boolean}
   */
  unregisterWorkZone(id) {
    const deleted = this.workZones.delete(id);
    if (deleted) {
      this.clearMemoryCache();
    }
    return deleted;
  }

  /**
   * Resets work zones registry to default state.
   */
  resetWorkZones() {
    this._initDefaultWorkZones();
    this.clearMemoryCache();
  }

  /**
   * Normalizes bounding box input into standard { minLat, maxLat, minLng, maxLng }.
   * @param {Object|Array} bounds
   * @returns {Object|null}
   */
  normalizeBounds(bounds) {
    if (!bounds) return null;

    let minLat, maxLat, minLng, maxLng;

    if (Array.isArray(bounds)) {
      // GeoJSON BBOX [minLng, minLat, maxLng, maxLat] or [minLat, minLng, maxLat, maxLng]
      if (bounds.length === 4) {
        if (bounds.every(v => Number.isFinite(Number(v)))) {
          const b0 = Number(bounds[0]);
          const b1 = Number(bounds[1]);
          const b2 = Number(bounds[2]);
          const b3 = Number(bounds[3]);

          // Heuristic: if bounds[0] looks like longitude and bounds[1] looks like latitude
          if (Math.abs(b0) <= 180 && Math.abs(b1) <= 90 && Math.abs(b2) <= 180 && Math.abs(b3) <= 90) {
            minLng = Math.min(b0, b2);
            maxLng = Math.max(b0, b2);
            minLat = Math.min(b1, b3);
            maxLat = Math.max(b1, b3);
          } else {
            minLat = Math.min(b0, b2);
            maxLat = Math.max(b0, b2);
            minLng = Math.min(b1, b3);
            maxLng = Math.max(b1, b3);
          }
        } else {
          return null;
        }
      } else {
        return null;
      }
    } else if (typeof bounds === 'object') {
      minLat = Number(bounds.minLat ?? bounds.south ?? bounds.minLatitude ?? bounds.bottom);
      maxLat = Number(bounds.maxLat ?? bounds.north ?? bounds.maxLatitude ?? bounds.top);
      minLng = Number(bounds.minLng ?? bounds.west ?? bounds.minLongitude ?? bounds.left);
      maxLng = Number(bounds.maxLng ?? bounds.east ?? bounds.maxLongitude ?? bounds.right);
    } else {
      return null;
    }

    if (
      !Number.isFinite(minLat) ||
      !Number.isFinite(maxLat) ||
      !Number.isFinite(minLng) ||
      !Number.isFinite(maxLng)
    ) {
      return null;
    }

    // Latitude bounds clamp/validation
    if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
      return null;
    }

    if (minLat > maxLat) {
      const temp = minLat;
      minLat = maxLat;
      maxLat = temp;
    }

    if (minLng > maxLng) {
      const temp = minLng;
      minLng = maxLng;
      maxLng = temp;
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Filters work zones by type, status, or severity.
   * @param {Array<Object>} workZones
   * @param {Object} filters
   * @returns {Array<Object>}
   */
  filterWorkZones(workZones, filters = {}) {
    if (!Array.isArray(workZones)) return [];

    let filtered = [...workZones];

    // Filter by type(s)
    const rawTypes = filters.types ?? filters.type;
    if (rawTypes) {
      const typeList = Array.isArray(rawTypes)
        ? rawTypes.map(t => String(t).toLowerCase())
        : [String(rawTypes).toLowerCase()];

      filtered = filtered.filter(wz => wz.type && typeList.includes(wz.type.toLowerCase()));
    }

    // Filter by status (e.g. 'active', 'scheduled', 'resolved')
    if (filters.status) {
      const statusList = Array.isArray(filters.status)
        ? filters.status.map(s => String(s).toLowerCase())
        : [String(filters.status).toLowerCase()];

      filtered = filtered.filter(wz => wz.status && statusList.includes(wz.status.toLowerCase()));
    }

    // Filter by severity (e.g. 'low', 'medium', 'high', 'critical')
    if (filters.severity) {
      const severityList = Array.isArray(filters.severity)
        ? filters.severity.map(s => String(s).toLowerCase())
        : [String(filters.severity).toLowerCase()];

      filtered = filtered.filter(wz => wz.severity && severityList.includes(wz.severity.toLowerCase()));
    }

    // Filter by min delay
    if (Number.isFinite(Number(filters.minDelayMinutes))) {
      const minDelay = Number(filters.minDelayMinutes);
      filtered = filtered.filter(wz => (Number(wz.estimatedDelayMins) || 0) >= minDelay);
    }

    return filtered;
  }

  /**
   * Filters work zones by specific type or list of types (construction, accident, closure, etc.).
   * @param {Array<Object>} workZones
   * @param {string|Array<string>} typeOrTypes
   * @returns {Array<Object>}
   */
  filterWorkZonesByType(workZones, typeOrTypes) {
    return this.filterWorkZones(workZones, { types: typeOrTypes });
  }

  /**
   * Generates a deterministic cache key for query parameters.
   */
  _buildCacheKey(normBounds, filters = {}) {
    const { minLat, maxLat, minLng, maxLng } = normBounds;
    const types = Array.isArray(filters.types ?? filters.type)
      ? (filters.types ?? filters.type).map(t => String(t).toLowerCase()).sort().join(',')
      : (filters.types ?? filters.type ? String(filters.types ?? filters.type).toLowerCase() : 'all');
    const status = filters.status ? (Array.isArray(filters.status) ? filters.status.sort().join(',') : String(filters.status)) : 'any';
    const severity = filters.severity ? (Array.isArray(filters.severity) ? filters.severity.sort().join(',') : String(filters.severity)) : 'any';

    return `workzone:${minLat.toFixed(3)}_${maxLat.toFixed(3)}_${minLng.toFixed(3)}_${maxLng.toFixed(3)}:t=${types}:s=${status}:v=${severity}`;
  }

  /**
   * Queries work zones within geographic bounds, with filtering and caching.
   * @param {Object|Array} bounds
   * @param {Object} options { types, type, status, severity, minDelayMinutes, bypassCache, ttlSeconds }
   * @returns {Promise<Array<Object>>}
   */
  async queryWorkZones(bounds, options = {}) {
    const normBounds = this.normalizeBounds(bounds);
    if (!normBounds) {
      logger.warn('[WorkZoneService] Invalid geographic bounds provided to queryWorkZones');
      return [];
    }

    const cacheKey = this._buildCacheKey(normBounds, options);
    const bypassCache = Boolean(options.bypassCache);
    const ttl = Number(options.ttlSeconds) || DEFAULT_CACHE_TTL_SECONDS;

    // 1. Check in-memory cache
    if (!bypassCache) {
      const memCached = this.memoryCache.get(cacheKey);
      if (memCached && memCached.expiresAt > Date.now()) {
        this.cacheStats.hits++;
        return memCached.data;
      }

      // 2. Check Redis cache if available
      if (redisClient) {
        try {
          const redisData = await redisClient.get(cacheKey);
          if (redisData) {
            const parsed = JSON.parse(redisData);
            this.memoryCache.set(cacheKey, { data: parsed, expiresAt: Date.now() + ttl * 1000 });
            this.cacheStats.hits++;
            return parsed;
          }
        } catch (cacheErr) {
          logger.debug(`[WorkZoneService] Redis cache read failed: ${cacheErr.message}`);
        }
      }
    }

    this.cacheStats.misses++;

    // Compute matching work zones within geographic bounds
    const { minLat, maxLat, minLng, maxLng } = normBounds;
    const inBounds = [];

    for (const wz of this.workZones.values()) {
      if (wz.lat >= minLat && wz.lat <= maxLat && wz.lng >= minLng && wz.lng <= maxLng) {
        inBounds.push({ ...wz });
      }
    }

    const result = this.filterWorkZones(inBounds, options);

    // Write to cache
    if (!bypassCache) {
      this.memoryCache.set(cacheKey, { data: result, expiresAt: Date.now() + ttl * 1000 });
      if (redisClient) {
        try {
          await redisClient.set(cacheKey, JSON.stringify(result), 'EX', ttl);
        } catch (setErr) {
          logger.debug(`[WorkZoneService] Redis cache write failed: ${setErr.message}`);
        }
      }
    }

    return result;
  }

  /**
   * Alias for queryWorkZones for consistent naming across GIS services.
   */
  async getWorkZonesInBounds(bounds, options = {}) {
    return this.queryWorkZones(bounds, options);
  }

  /**
   * Generates a structured real-time alert payload from a work zone record.
   * @param {Object} workZone
   * @returns {Object}
   */
  generateWorkZoneAlert(workZone) {
    if (!workZone || typeof workZone !== 'object') {
      return null;
    }

    const lat = Number(workZone.lat);
    const lng = Number(workZone.lng);
    const delayMins = Number(workZone.estimatedDelayMins) || 0;
    const isSevere = delayMins >= SEVERE_DELAY_THRESHOLD_MINS;

    const alertId = `WZ-ALERT-${workZone.id || crypto.randomUUID()}`;
    const isActive = workZone.status === WORK_ZONE_STATUS.ACTIVE || workZone.active === true;

    let bypass = null;
    if (Number.isFinite(lat) && Number.isFinite(lng) && delayMins >= 15) {
      bypass = generateBypassWaypoint({ lat, lng });
    }

    return {
      alertId,
      workZoneId: workZone.id || null,
      type: workZone.type || WORK_ZONE_TYPES.CONSTRUCTION,
      severity: workZone.severity || (isSevere ? WORK_ZONE_SEVERITY.CRITICAL : WORK_ZONE_SEVERITY.MEDIUM),
      title: workZone.title || `Alert: ${String(workZone.type || 'Work Zone').toUpperCase()} on route`,
      description: workZone.description || workZone.message || 'Commercial route obstruction detected.',
      location: {
        lat,
        lng,
        address: workZone.address || workZone.title || 'Work Zone Location'
      },
      delayMinutes: delayMins,
      hasSevereDelay: isSevere,
      active: isActive,
      impact: workZone.impact || (isSevere ? 'SEVERE_DELAY' : 'TRAFFIC_SLOWDOWN'),
      suggestedBypass: bypass,
      createdAt: workZone.startTime || new Date().toISOString(),
      expiresAt: workZone.endTime || new Date(Date.now() + 3600000).toISOString()
    };
  }

  /**
   * Generates real-time alerts for an array of work zones, optionally filtering for active only.
   * @param {Array<Object>} workZones
   * @param {Object} options { activeOnly: boolean, minSeverity: string }
   * @returns {Array<Object>}
   */
  generateWorkZoneAlerts(workZones, options = {}) {
    if (!Array.isArray(workZones)) return [];

    const activeOnly = options.activeOnly !== false; // defaults to true
    let targets = [...workZones];

    if (activeOnly) {
      targets = targets.filter(wz => wz.status === WORK_ZONE_STATUS.ACTIVE || wz.active === true || !wz.status);
    }

    if (options.minSeverity) {
      const severityOrder = {
        [WORK_ZONE_SEVERITY.LOW]: 1,
        [WORK_ZONE_SEVERITY.MEDIUM]: 2,
        [WORK_ZONE_SEVERITY.HIGH]: 3,
        [WORK_ZONE_SEVERITY.CRITICAL]: 4
      };
      const minLevel = severityOrder[options.minSeverity.toLowerCase()] || 1;
      targets = targets.filter(wz => (severityOrder[String(wz.severity).toLowerCase()] || 2) >= minLevel);
    }

    return targets.map(wz => this.generateWorkZoneAlert(wz)).filter(Boolean);
  }

  /**
   * Queries work zones in bounds and produces alerts for all active work zones.
   * @param {Object|Array} bounds
   * @param {Object} options
   * @returns {Promise<Array<Object>>}
   */
  async getActiveWorkZoneAlerts(bounds, options = {}) {
    const workZones = await this.queryWorkZones(bounds, {
      ...options,
      status: WORK_ZONE_STATUS.ACTIVE
    });
    return this.generateWorkZoneAlerts(workZones, { ...options, activeOnly: true });
  }

  /**
   * Clears in-memory cache.
   */
  clearMemoryCache() {
    this.memoryCache.clear();
  }

  /**
   * Clears all cache (memory and Redis if present).
   */
  async clearWorkZoneCache() {
    this.clearMemoryCache();
    if (redisClient) {
      try {
        if (typeof redisClient.keys === 'function') {
          const keys = await redisClient.keys('workzone:*');
          if (keys.length > 0 && typeof redisClient.del === 'function') {
            await redisClient.del(...keys);
          }
        }
      } catch (err) {
        logger.debug(`[WorkZoneService] Error clearing Redis keys: ${err.message}`);
      }
    }
  }

  /**
   * Returns cache metrics.
   */
  getCacheStats() {
    return {
      memoryEntries: this.memoryCache.size,
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses
    };
  }
}

// Singleton instance
export const workZoneService = new WorkZoneService();

/**
 * Predicts work-zone delays based on coordinates and departure time.
 * In a production environment, this would aggregate State DOT construction schedules,
 * live lane closure APIs, and historical heavy-traffic data.
 * 
 * @param {Object} start { lat, lng }
 * @param {Object} end { lat, lng }
 * @param {Array} waypoints [{ lat, lng }]
 * @param {string} departureDate YYYY-MM-DD
 * @param {string} departureTime HH:MM
 * @returns {Promise<Object>} { hasSevereDelay, predictedDelayMins, problematicPoint }
 */
export async function predictWorkZoneDelays(start, end, waypoints = [], departureDate, departureTime) {
  try {
    const allPoints = [start, ...waypoints, end].filter(
      p => p != null && 
           typeof p === 'object' && 
           Number.isFinite(Number(p.lat)) && 
           Number.isFinite(Number(p.lng))
    );
    if (allPoints.length === 0) {
      return { hasSevereDelay: false, predictedDelayMins: 0, problematicPoint: null };
    }

    // Combine date and time for seeding the predictive heuristic
    const timeString = `${departureDate || ''}T${departureTime || ''}`;
    // Simple numeric seed based on the string
    const timeSeed = timeString.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 1;

    let maxDelayMins = 0;
    let worstPoint = null;

    for (const point of allPoints) {
      // Simulate historical traffic and DOT schedules using a pseudo-random hash of coords and time
      const latHash = Math.abs(Math.sin(Number(point.lat)) * 100);
      const lngHash = Math.abs(Math.cos(Number(point.lng)) * 100);
      
      // Some coordinates + time combinations will yield high delay spikes
      const delayScore = ((latHash + lngHash) * timeSeed) % 100; // 0 to 99

      if (delayScore > maxDelayMins) {
        maxDelayMins = delayScore;
        worstPoint = point;
      }
    }

    const hasSevereDelay = maxDelayMins >= SEVERE_DELAY_THRESHOLD_MINS;

    if (hasSevereDelay && worstPoint) {
      logger.info(`[WorkZoneService] Predicted severe commercial delay of ${maxDelayMins.toFixed(0)} mins at ${worstPoint.lat}, ${worstPoint.lng} on ${timeString}`);
    }

    return {
      hasSevereDelay,
      predictedDelayMins: maxDelayMins,
      problematicPoint: hasSevereDelay ? worstPoint : null
    };

  } catch (error) {
    logger.error(`[WorkZoneService] Error predicting work-zone delays: ${error?.message ?? String(error)}`);
    // Fail open: assume no severe delay if predictive engine fails
    return { hasSevereDelay: false, predictedDelayMins: 0, problematicPoint: null };
  }
}

/**
 * Generates an alternative bypass waypoint to force OSRM to route around the congested work zone.
 *
 * @param {Object} congestedPoint { lat, lng }
 * @returns {Object} bypassWaypoint { lat, lng }
 */
export function generateBypassWaypoint(congestedPoint) {
  if (!congestedPoint || typeof congestedPoint !== 'object') {
    return null;
  }

  // `lat`/`lng` of 0 are valid coordinates (the equator and the prime
  // meridian), so presence must be checked against null/undefined rather than
  // truthiness. Both coordinates are validated, and must be in WGS84 range,
  // because routingService.normalizeCoordinatePoint throws on anything else
  // and would fail the whole route request.
  if (congestedPoint.lat == null || congestedPoint.lng == null) {
    return null;
  }
  const lat = Number(congestedPoint.lat);
  const lng = Number(congestedPoint.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  // To bypass a congested point (e.g. radius of 5km), we shift the coordinate perpendicularly.
  // 1 degree of latitude is ~111 km. To shift by ~7 km:
  const shiftDegrees = 7 / 111;

  // We'll apply a simple static offset. In a real GIS engine, we'd find the nearest alternative highway.
  // For now, shifting latitude slightly forces the routing engine (OSRM) to use a different arterial road.
  const bypassLat = lat + shiftDegrees;
  const bypassLng = lng + shiftDegrees;

  logger.info(`[WorkZoneService] Generated bypass waypoint at ${bypassLat.toFixed(5)}, ${bypassLng.toFixed(5)} to avoid work zone at ${lat}, ${lng}`);

  return {
    lat: bypassLat,
    lng: bypassLng,
    address: 'Predictive Bypass Waypoint'
  };
}

// Function export bindings matching singleton methods for modular consumers
export const queryWorkZones = (bounds, options) => workZoneService.queryWorkZones(bounds, options);
export const getWorkZonesInBounds = (bounds, options) => workZoneService.getWorkZonesInBounds(bounds, options);
export const filterWorkZones = (workZones, filters) => workZoneService.filterWorkZones(workZones, filters);
export const filterWorkZonesByType = (workZones, types) => workZoneService.filterWorkZonesByType(workZones, types);
export const generateWorkZoneAlert = (workZone) => workZoneService.generateWorkZoneAlert(workZone);
export const generateWorkZoneAlerts = (workZones, options) => workZoneService.generateWorkZoneAlerts(workZones, options);
export const getActiveWorkZoneAlerts = (bounds, options) => workZoneService.getActiveWorkZoneAlerts(bounds, options);
export const registerWorkZone = (workZone) => workZoneService.registerWorkZone(workZone);
export const unregisterWorkZone = (id) => workZoneService.unregisterWorkZone(id);
export const resetWorkZones = () => workZoneService.resetWorkZones();
export const clearWorkZoneCache = () => workZoneService.clearWorkZoneCache();
export const normalizeBounds = (bounds) => workZoneService.normalizeBounds(bounds);

export default workZoneService;

