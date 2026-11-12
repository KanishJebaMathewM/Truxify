import { supabaseAdmin, supabase } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import { getRouteEstimate } from '../osrm.js';
import { getHaversineDistance } from '../routingService.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { DomainError } from './domainError.js';

const DEFAULT_MAX_DETOUR_KM = 45;
const DEFAULT_MAX_DETOUR_MINUTES = 60;
const ESTIMATED_FUEL_COST_PER_KM_INR = 14.5; // Average Indian logistics commercial diesel rate per km
const ALLOWED_OFFER_STATUSES = ['available'];
const ACTIVE_ORDER_STATUSES = new Set([
  'active',
  'assigned',
  'accepted',
  'truck_assigned',
  'en_route',
  'en_route_pickup',
  'arrived_pickup',
  'at_pickup',
  'loading',
  'picked_up',
  'in_transit',
  'arriving',
]);

function normalizeIdentifier(value, field) {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 100) {
    throw new DomainError(400, { error: `${field} must be a non-empty string of at most 100 characters` });
  }
  return value.trim();
}

function parseCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateOfferCoordinates(loadOffer) {
  const pickupLat = parseCoordinate(loadOffer.pickup_lat);
  const pickupLng = parseCoordinate(loadOffer.pickup_lng);
  const dropLat = parseCoordinate(loadOffer.drop_lat);
  const dropLng = parseCoordinate(loadOffer.drop_lng);

  if (
    pickupLat === null ||
    pickupLng === null ||
    dropLat === null ||
    dropLng === null ||
    pickupLat < -90 ||
    pickupLat > 90 ||
    dropLat < -90 ||
    dropLat > 90 ||
    pickupLng < -180 ||
    pickupLng > 180 ||
    dropLng < -180 ||
    dropLng > 180
  ) {
    throw new DomainError(422, { error: 'Load offer has invalid pickup or drop coordinates' });
  }

  return { pickupLat, pickupLng, dropLat, dropLng };
}

function routeDurationMinutes(route, distanceKm) {
  return Number.isFinite(route?.durationSeconds) && route.durationSeconds >= 0
    ? route.durationSeconds / 60
    : distanceKm * 1.5;
}

/**
 * Deadhead & Mid-Trip Route Optimization Service
 * Identifies compatible cargo pickups along active route buffers and manages
 * atomic multi-stop waypoint insertions.
 */
class DeadheadMatchingService {
  /**
   * Calculates deviation penalty curves and ranks mid-trip load opportunities.
   *
   * @param {object} params
   * @param {string} params.driverId
   * @param {string} params.activeOrderId
   * @param {number} params.currentLat
   * @param {number} params.currentLng
   * @param {number} [params.maxDetourKm=45]
   * @param {number} [params.maxDetourMinutes=60]
   * @returns {Promise<{ opportunities: Array, baselineRoute: object }>}
   */
  async findMidTripLoadOpportunities({
    driverId,
    activeOrderId,
    currentLat,
    currentLng,
    maxDetourKm = DEFAULT_MAX_DETOUR_KM,
    maxDetourMinutes = DEFAULT_MAX_DETOUR_MINUTES,
  }) {
    return measureExecution('DeadheadMatchingService.findMidTripLoadOpportunities', async () => {
      const client = supabaseAdmin ?? supabase;
      if (!client) {
        throw new Error('Database client unconfigured');
      }

      // 1. Fetch active order and destination
      const { data: activeOrder, error: orderError } = await client
        .from('orders')
        .select('id, drop_lat, drop_lng, drop_location, status, waypoints, eta')
        .eq('id', activeOrderId)
        .maybeSingle();

      if (orderError || !activeOrder) {
        logger.warn(`[DeadheadMatching] Active order not found: ${activeOrderId}`);
        return { opportunities: [], baselineRoute: null };
      }

      const destLat = Number(activeOrder.drop_lat);
      const destLng = Number(activeOrder.drop_lng);

      if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        return { opportunities: [], baselineRoute: null };
      }

      // 2. Baseline direct route estimate from current position to final destination
      const directRoute = await getRouteEstimate({
        pickupLat: currentLat,
        pickupLng: currentLng,
        dropLat: destLat,
        dropLng: destLng,
      });

      const baselineDistanceKm = directRoute?.distanceKm ?? (getHaversineDistance(currentLat, currentLng, destLat, destLng) / 1000);
      const baselineDurationMins = routeDurationMinutes(directRoute, baselineDistanceKm);

      // 3. Fetch candidate active load offers
      const { data: availableOffers, error: offersError } = await client
        .from('load_offers')
        .select('*')
        .in('status', ALLOWED_OFFER_STATUSES)
        .limit(50);

      if (offersError || !availableOffers || availableOffers.length === 0) {
        return {
          opportunities: [],
          baselineRoute: { distanceKm: baselineDistanceKm, durationMinutes: baselineDurationMins }
        };
      }

      const opportunities = [];

      for (const offer of availableOffers) {
        const pLat = Number(offer.pickup_lat);
        const pLng = Number(offer.pickup_lng);
        const dLat = Number(offer.drop_lat);
        const dLng = Number(offer.drop_lng);

        if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
          continue;
        }

        // Leg 1: current -> offer pickup
        // Leg 2: offer pickup -> offer drop
        // Leg 3: offer drop -> order final destination
        const [leg1, leg2, leg3] = await Promise.all([
          getRouteEstimate({ pickupLat: currentLat, pickupLng: currentLng, dropLat: pLat, dropLng: pLng }),
          getRouteEstimate({ pickupLat: pLat, pickupLng: pLng, dropLat: dLat, dropLng: dLng }),
          getRouteEstimate({ pickupLat: dLat, pickupLng: dLng, dropLat: destLat, dropLng: destLng }),
        ]);

        const dist1 = leg1?.distanceKm ?? (getHaversineDistance(currentLat, currentLng, pLat, pLng) / 1000);
        const dist2 = leg2?.distanceKm ?? (getHaversineDistance(pLat, pLng, dLat, dLng) / 1000);
        const dist3 = leg3?.distanceKm ?? (getHaversineDistance(dLat, dLng, destLat, destLng) / 1000);

        const dur1 = routeDurationMinutes(leg1, dist1);
        const dur2 = routeDurationMinutes(leg2, dist2);
        const dur3 = routeDurationMinutes(leg3, dist3);

        const totalInsertedDistanceKm = dist1 + dist2 + dist3;
        const totalInsertedDurationMins = dur1 + dur2 + dur3;

        const marginalDetourKm = Math.max(0, totalInsertedDistanceKm - baselineDistanceKm);
        const marginalDetourMinutes = Math.max(0, totalInsertedDurationMins - baselineDurationMins);

        // Filter against detour tolerance
        if (marginalDetourKm > maxDetourKm || marginalDetourMinutes > maxDetourMinutes) {
          continue;
        }

        const offerPayout = Number(offer.price || offer.offered_amount || 0);
        const estimatedIncrementalFuel = marginalDetourKm * ESTIMATED_FUEL_COST_PER_KM_INR;
        const netMarginalEarnings = Math.max(0, offerPayout - estimatedIncrementalFuel);

        // Efficiency score = net profit per minute of detour
        const efficiencyScore = Number((netMarginalEarnings / Math.max(1, marginalDetourMinutes)).toFixed(2));

        opportunities.push({
          loadOfferId: offer.id,
          title: offer.title || `Load ${offer.id.slice(0, 8)}`,
          pickupLocation: offer.pickup_location,
          dropLocation: offer.drop_location,
          pickupLat: pLat,
          pickupLng: pLng,
          dropLat: dLat,
          dropLng: dLng,
          grossPayout: offerPayout,
          estimatedFuelCost: Number(estimatedIncrementalFuel.toFixed(2)),
          netMarginalEarnings: Number(netMarginalEarnings.toFixed(2)),
          marginalDetourKm: Number(marginalDetourKm.toFixed(2)),
          marginalDetourMinutes: Math.round(marginalDetourMinutes),
          totalRouteDistanceKm: Number(totalInsertedDistanceKm.toFixed(2)),
          efficiencyScore,
        });
      }

      // Sort descending by profit efficiency score
      opportunities.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

      return {
        opportunities,
        baselineRoute: {
          distanceKm: Number(baselineDistanceKm.toFixed(2)),
          durationMinutes: Math.round(baselineDurationMins),
        },
      };
    });
  }

  /**
   * Atomically inserts a mid-trip load as sequenced waypoints into the active order.
   *
   * @param {object} params
   * @param {string} params.orderId
   * @param {string} params.loadOfferId
   * @param {string} params.driverId
   * @returns {Promise<{ success: boolean, waypoints: Array, order: object }>}
   */
  async insertMidTripLoad({ orderId, loadOfferId, driverId }) {
    return measureExecution('DeadheadMatchingService.insertMidTripLoad', async () => {
      const normalizedOrderId = normalizeIdentifier(orderId, 'orderId');
      const normalizedLoadOfferId = normalizeIdentifier(loadOfferId, 'loadOfferId');
      const normalizedDriverId = normalizeIdentifier(driverId, 'driverId');

      const client = supabaseAdmin ?? supabase;
      if (!client) {
        throw new Error('Database client unconfigured');
      }

      // 1. Fetch the order and enforce that the caller is its assigned driver.
      const { data: order, error: orderError } = await client
        .from('orders')
        .select('*')
        .eq('id', normalizedOrderId)
        .single();

      if (orderError || !order) {
        throw new DomainError(404, { error: `Order ${normalizedOrderId} not found` });
      }

      if (order.driver_id !== normalizedDriverId) {
        throw new DomainError(403, { error: 'Access Denied: Order is not assigned to this driver' });
      }

      if (!ACTIVE_ORDER_STATUSES.has(String(order.status || '').toLowerCase())) {
        throw new DomainError(409, { error: 'Cannot insert a mid-trip load into an inactive order' });
      }

      // 2. Fetch the load offer and require an insertable state.
      const { data: loadOffer, error: loadError } = await client
        .from('load_offers')
        .select('*')
        .eq('id', normalizedLoadOfferId)
        .single();

      if (loadError || !loadOffer) {
        throw new DomainError(404, { error: `Load offer ${normalizedLoadOfferId} not found` });
      }

      if (!ALLOWED_OFFER_STATUSES.includes(loadOffer.status)) {
        throw new DomainError(409, { error: 'Load offer is no longer available for insertion' });
      }

      const { pickupLat, pickupLng, dropLat, dropLng } = validateOfferCoordinates(loadOffer);

      const existingWaypoints = Array.isArray(order.waypoints) ? [...order.waypoints] : [];
      if (existingWaypoints.some((waypoint) => waypoint?.load_id === normalizedLoadOfferId)) {
        throw new DomainError(409, { error: 'Load offer has already been inserted into this order' });
      }

      const now = new Date().toISOString();
      const newWaypoints = [
        ...existingWaypoints,
        {
          id: `wp-pickup-${normalizedLoadOfferId.slice(0, 8)}`,
          type: 'mid_trip_pickup',
          load_id: normalizedLoadOfferId,
          lat: pickupLat,
          lng: pickupLng,
          address: loadOffer.pickup_location,
          status: 'pending',
          created_at: now,
        },
        {
          id: `wp-drop-${normalizedLoadOfferId.slice(0, 8)}`,
          type: 'mid_trip_drop',
          load_id: normalizedLoadOfferId,
          lat: dropLat,
          lng: dropLng,
          address: loadOffer.drop_location,
          status: 'pending',
          created_at: now,
        },
      ];

      // 3. Claim the offer first with a conditional status update. If another
      // request claimed it concurrently, no row is returned and the order is
      // left untouched.
      const { data: claimedOffer, error: claimError } = await client
        .from('load_offers')
        .update({
          status: 'claimed',
          updated_at: now,
        })
        .eq('id', normalizedLoadOfferId)
        .in('status', ALLOWED_OFFER_STATUSES)
        .select('id')
        .maybeSingle();

      if (claimError) {
        logger.error({ err: claimError }, '[DeadheadMatching] Failed to claim load offer');
        throw new DomainError(500, { error: 'Failed to claim load offer' });
      }
      if (!claimedOffer) {
        throw new DomainError(409, { error: 'Load offer is no longer available for insertion' });
      }

      // 4. Update the order only after the offer claim succeeds. The driver
      // predicate is repeated here so a stale order object cannot bypass the
      // authorization check above.
      const { data: updatedOrder, error: updateOrderErr } = await client
        .from('orders')
        .update({
          waypoints: newWaypoints,
          updated_at: now,
        })
        .eq('id', normalizedOrderId)
        .eq('driver_id', normalizedDriverId)
        .in('status', [...ACTIVE_ORDER_STATUSES])
        .select()
        .single();

      if (updateOrderErr || !updatedOrder) {
        logger.error({ err: updateOrderErr }, '[DeadheadMatching] Failed to update order waypoints');

        // Compensate the offer claim so a transient order failure does not
        // leave the offer permanently matched with no waypoints.
        try {
          const { error: rollbackError } = await client
            .from('load_offers')
            .update({
              status: loadOffer.status,
              updated_at: new Date().toISOString(),
            })
            .eq('id', normalizedLoadOfferId)
            .eq('status', 'claimed');

          if (rollbackError) {
            logger.error({ err: rollbackError }, '[DeadheadMatching] Failed to roll back load offer claim');
          }
        } catch (rollbackException) {
          logger.error({ err: rollbackException }, '[DeadheadMatching] Failed to roll back load offer claim');
        }

        throw new DomainError(500, { error: 'Failed to update order waypoints' });
      }

      logger.info(`[DeadheadMatching] Successfully inserted mid-trip load ${normalizedLoadOfferId} into Order ${normalizedOrderId}`);

      return {
        success: true,
        orderId: normalizedOrderId,
        loadOfferId: normalizedLoadOfferId,
        waypoints: newWaypoints,
        order: updatedOrder,
      };
    });
  }
}

export const deadheadMatchingService = new DeadheadMatchingService();
export default deadheadMatchingService;
