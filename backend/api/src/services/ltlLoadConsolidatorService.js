import axios from 'axios';
import logger from '../middleware/logger.js';
import { supabaseAdmin } from '../config/db.js';

export class LtlLoadConsolidatorService {
  /**
   * @param {object} [options={}]
   * @param {string} [options.mlServiceUrl]
   * @param {number} [options.timeoutMs=8000]
   */
  constructor(options = {}) {
    this.mlServiceUrl = options.mlServiceUrl || process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
    this.timeoutMs = options.timeoutMs || 8000;
    this.supabase = options.supabase || supabaseAdmin;
  }

  /**
   * Consolidates multiple LTL bookings into a single optimized composite trip.
   * 
   * @param {object} params
   * @param {string} params.driverId - Assigned driver UUID
   * @param {string} params.vehicleRegistration - Vehicle number
   * @param {object} params.truckSpecs - Dimensions and weight capacity
   * @param {Array<object>} params.candidateBookings - Array of LTL order objects
   * @returns {Promise<object>} Consolidated composite trip summary
   */
  async consolidateBookings(params) {
    const {
      driverId,
      vehicleRegistration,
      truckSpecs = {},
      candidateBookings = [],
    } = params;

    if (!driverId || candidateBookings.length < 2) {
      throw new Error('At least 2 candidate bookings and a driverId are required for LTL consolidation');
    }

    // 1. Format payload for FastAPI ML Optimization service
    const formattedConsignments = candidateBookings.map((b) => ({
      id: b.id,
      weight_kg: Number(b.weight_kg || b.weight || 1000),
      pickup: {
        lat: Number(b.pickup_lat),
        lng: Number(b.pickup_lng),
        name: b.pickup_address || `Pickup #${b.id.slice(0, 6)}`,
        time_window_start_min: b.pickup_tw_start || 0,
        time_window_end_min: b.pickup_tw_end || 1440,
      },
      delivery: {
        lat: Number(b.drop_lat || b.delivery_lat),
        lng: Number(b.drop_lng || b.delivery_lng),
        name: b.drop_address || `Delivery #${b.id.slice(0, 6)}`,
        time_window_start_min: b.delivery_tw_start || 0,
        time_window_end_min: b.delivery_tw_end || 1440,
      },
      cargo_items: b.cargo_items || [
        {
          id: `item_1`,
          length: Number(b.length_m || 1.2),
          width: Number(b.width_m || 1.0),
          height: Number(b.height_m || 1.5),
          weight_kg: Number(b.weight_kg || b.weight || 1000),
          stackable: Boolean(b.stackable ?? true),
          fragile: Boolean(b.fragile ?? false),
          allow_rotation: Boolean(b.allow_rotation ?? true),
        },
      ],
    }));

    const payload = {
      truck_specs: {
        length_m: Number(truckSpecs.length_m || 12.0),
        width_m: Number(truckSpecs.width_m || 2.4),
        height_m: Number(truckSpecs.height_m || 2.6),
        max_weight_kg: Number(truckSpecs.max_weight_kg || 25000),
      },
      consignments: formattedConsignments,
    };

    logger.info(
      { driverId, consignmentCount: candidateBookings.length },
      '[LtlLoadConsolidatorService] Sending consolidation request to ML engine'
    );

    // 2. Call ML 3D Packing + CVRPTW Optimization Service
    const mlResponse = await axios.post(`${this.mlServiceUrl}/api/v1/ml/consolidate-loads`, payload, {
      timeout: this.timeoutMs,
    });

    const solution = mlResponse.data;
    if (!solution || !solution.success) {
      throw new Error('Consolidation optimization failed: Cargo exceeds physical space or time windows');
    }

    const { packing_solution, routing_solution } = solution;

    // 3. Persist Parent Composite Trip to Database
    let compositeTripId = null;
    if (this.supabase && typeof this.supabase.from === 'function') {
      const { data: tripData, error: tripError } = await this.supabase
        .from('composite_trips')
        .insert({
          driver_id: driverId,
          vehicle_registration: vehicleRegistration,
          vehicle_max_weight_kg: payload.truck_specs.max_weight_kg,
          vehicle_length_m: payload.truck_specs.length_m,
          vehicle_width_m: payload.truck_specs.width_m,
          vehicle_height_m: payload.truck_specs.height_m,
          total_consignments: candidateBookings.length,
          total_weight_kg: packing_solution.statistics.total_packed_weight_kg,
          volume_utilization_pct: packing_solution.statistics.volume_utilization_pct,
          center_of_gravity_x_m: packing_solution.statistics.center_of_gravity_x_m,
          is_axle_balanced: packing_solution.statistics.is_axle_balanced,
          total_distance_km: routing_solution.total_distance_km,
          estimated_duration_hours: routing_solution.total_duration_hours,
          status: 'PLANNED',
          itinerary_json: routing_solution.itinerary,
        })
        .select('id')
        .single();

      if (tripError) {
        logger.error({ err: tripError }, '[LtlLoadConsolidatorService] Failed persisting composite trip');
      } else {
        compositeTripId = tripData?.id;

        // 4. Persist Child Consignments
        const childConsignmentRows = candidateBookings.map((b) => {
          const pickupStop = routing_solution.itinerary.find(
            (s) => s.consignment_id === b.id && s.type === 'PICKUP'
          );
          const dropoffStop = routing_solution.itinerary.find(
            (s) => s.consignment_id === b.id && s.type === 'DELIVERY'
          );
          const packedPlacements = packing_solution.packed_items.filter((it) =>
            it.id.startsWith(b.id)
          );

          return {
            composite_trip_id: compositeTripId,
            booking_id: b.id,
            customer_id: b.customer_id || b.shipper_id || '00000000-0000-0000-0000-000000000000',
            consignment_weight_kg: Number(b.weight_kg || b.weight || 1000),
            pickup_stop_sequence: pickupStop ? pickupStop.sequence : 1,
            delivery_stop_sequence: dropoffStop ? dropoffStop.sequence : 2,
            packed_coordinates_json: packedPlacements,
            payout_paisa: Number(b.bid_amount || b.payout_paisa || 0),
            status: 'ASSIGNED',
          };
        });

        await this.supabase.from('trip_consignments').insert(childConsignmentRows);
      }
    }

    return {
      success: true,
      compositeTripId,
      totalDistanceKm: routing_solution.total_distance_km,
      totalDurationHours: routing_solution.total_duration_hours,
      packingSummary: {
        volumeUtilizationPct: packing_solution.statistics.volume_utilization_pct,
        weightUtilizationPct: packing_solution.statistics.weight_utilization_pct,
        isAxleBalanced: packing_solution.statistics.is_axle_balanced,
      },
      itinerary: routing_solution.itinerary,
      packedItemsCount: packing_solution.packed_items.length,
      unpackedItemsCount: packing_solution.unpacked_items.length,
    };
  }
}

export default LtlLoadConsolidatorService;
