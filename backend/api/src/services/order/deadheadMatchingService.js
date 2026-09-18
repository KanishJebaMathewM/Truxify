import { supabaseAdmin, supabase } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import { getRouteEstimate } from '../osrm.js';
import { getHaversineDistance } from '../routingService.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const DEFAULT_MAX_DETOUR_KM = 45;
const DEFAULT_MAX_DETOUR_MINUTES = 60;
const ESTIMATED_FUEL_COST_PER_KM_INR = 14.5; // Average Indian logistics commercial diesel rate per km

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
      const baselineDurationMins = directRoute?.durationMinutes ?? (baselineDistanceKm * 1.5);

      // 3. Fetch candidate active load offers
      const { data: availableOffers, error: offersError } = await client
        .from('load_offers')
        .select('*')
        .in('status', ['active', 'open', 'pending'])
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

        const dur1 = leg1?.durationMinutes ?? (dist1 * 1.5);
        const dur2 = leg2?.durationMinutes ?? (dist2 * 1.5);
        const dur3 = leg3?.durationMinutes ?? (dist3 * 1.5);

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
      const client = supabaseAdmin ?? supabase;
      if (!client) {
        throw new Error('Database client unconfigured');
      }

      // 1. Fetch the order
      const { data: order, error: orderError } = await client
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError || !order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // 2. Fetch the load offer
      const { data: loadOffer, error: loadError } = await client
        .from('load_offers')
        .select('*')
        .eq('id', loadOfferId)
        .single();

      if (loadError || !loadOffer) {
        throw new Error(`Load offer ${loadOfferId} not found`);
      }

      const existingWaypoints = Array.isArray(order.waypoints) ? [...order.waypoints] : [];

      const newWaypoints = [
        ...existingWaypoints,
        {
          id: `wp-pickup-${loadOfferId.slice(0, 8)}`,
          type: 'mid_trip_pickup',
          load_id: loadOfferId,
          lat: Number(loadOffer.pickup_lat),
          lng: Number(loadOffer.pickup_lng),
          address: loadOffer.pickup_location,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          id: `wp-drop-${loadOfferId.slice(0, 8)}`,
          type: 'mid_trip_drop',
          load_id: loadOfferId,
          lat: Number(loadOffer.drop_lat),
          lng: Number(loadOffer.drop_lng),
          address: loadOffer.drop_location,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ];

      // 3. Atomically update the order's waypoints
      const { data: updatedOrder, error: updateOrderErr } = await client
        .from('orders')
        .update({
          waypoints: newWaypoints,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .select()
        .single();

      if (updateOrderErr) {
        logger.error({ err: updateOrderErr }, '[DeadheadMatching] Failed to update order waypoints');
        throw updateOrderErr;
      }

      // 4. Update load_offer status
      await client
        .from('load_offers')
        .update({
          status: 'matched',
          matched_order_id: orderId,
          matched_driver_id: driverId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', loadOfferId);

      logger.info(`[DeadheadMatching] Successfully inserted mid-trip load ${loadOfferId} into Order ${orderId}`);

      return {
        success: true,
        orderId,
        loadOfferId,
        waypoints: newWaypoints,
        order: updatedOrder,
      };
    });
  }
}

export const deadheadMatchingService = new DeadheadMatchingService();
export default deadheadMatchingService;
