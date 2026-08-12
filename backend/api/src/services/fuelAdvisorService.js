/**
 * fuelAdvisorService.js
 * 
 * Intelligent Fueling Advisor service. Analyzes engine load and upcoming
 * weather to recommend the best biodiesel blend.
 */

export class FuelAdvisorService {
  constructor({ supabase, weatherService, logger }) {
    this.supabase = supabase;
    this.weatherService = weatherService;
    this.logger = logger;
  }

  /**
   * Recommend a biodiesel blend for a specific truck and destination.
   * 
   * @param {string} truckId - The ID of the truck
   * @param {number} destinationLat - Destination latitude
   * @param {number} destinationLng - Destination longitude
   * @returns {Promise<Object>} Recommendation payload
   */
  async getFuelRecommendation(truckId, destinationLat, destinationLng) {
    this.logger?.info(`[FuelAdvisorService] Computing recommendation for truck ${truckId} heading to ${destinationLat},${destinationLng}`);

    // 1. Get average engine load from recent telemetry
    const avgEngineLoad = await this._getAverageEngineLoad(truckId);

    // 2. Get weather forecast for destination
    const weather = await this.weatherService.getWeatherForecast(destinationLat, destinationLng);
    const tempC = weather.temperature_c;

    // 3. Compute recommendation
    // Temp <= 0C AND Load < 60% -> B5 (Low temp, low load -> high risk of gelling & DPF clog)
    // Temp <= 0C AND Load >= 60% -> B20 (Engine runs hot enough) or B10. Let's recommend B20 for max savings if load is high.
    // Temp > 0C -> B20 (Warmer weather, no risk)
    
    let blend = 'B20';
    let reasoning = 'Weather is warm enough for B20 Biodiesel, which offers cost savings and lower emissions.';
    let riskLevel = 'LOW';

    if (tempC <= 0) {
      if (avgEngineLoad < 60) {
        blend = 'B5';
        reasoning = 'Sub-zero temperatures expected and recent engine load is low. B5 is recommended to prevent fuel gelling and DPF clogging.';
        riskLevel = 'HIGH';
      } else {
        blend = 'B20';
        reasoning = 'Sub-zero temperatures expected, but high average engine load will maintain sufficient heat to prevent B20 gelling.';
        riskLevel = 'MEDIUM';
      }
    }

    return {
      recommended_blend: blend,
      reasoning,
      risk_level: riskLevel,
      factors: {
        weather_forecast: weather,
        average_engine_load_percent: Math.round(avgEngineLoad)
      }
    };
  }

  /**
   * Fetches recent trip events for the truck's active trip and calculates avg load.
   * If no data is available, returns a default value (e.g., 50%).
   */
  async _getAverageEngineLoad(truckId) {
    try {
      // Find the most recent active trip for this truck
      // We look up orders assigned to this truck. Wait, trips table has driver_id.
      // Orders have truck_id. Let's find the active order for the truck.
      const { data: order, error: orderErr } = await this.supabase
        .from('orders')
        .select('id, driver_id')
        .eq('truck_id', truckId)
        .in('status', ['active', 'in_transit', 'en_route_pickup'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orderErr || !order) {
        this.logger?.debug(`[FuelAdvisorService] No active order found for truck ${truckId}, assuming default load`);
        return 50; // Default load if no active trip
      }

      // Resolve the active trip for this order. trip_events.trip_id references
      // trips.id (not orders.id), so we must look up the trip first.
      const { data: trip, error: tripErr } = await this.supabase
        .from('trips')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

      if (tripErr || !trip) {
        this.logger?.debug(`[FuelAdvisorService] No trip found for order ${order.id}, assuming default load`);
        return 50; // Default load if no trip exists yet
      }

      // Find recent gpsUpdate events in trip_events for this trip
      const { data: events, error: eventsErr } = await this.supabase
        .from('trip_events')
        .select('metadata')
        .eq('trip_id', trip.id)
        .eq('event_type', 'gpsUpdate')
        .order('event_timestamp', { ascending: false })
        .limit(50);

      if (eventsErr || !events || events.length === 0) {
        return 50; // Default load
      }

      // Extract engineLoad from metadata and average
      let totalLoad = 0;
      let count = 0;

      for (const event of events) {
        const load = event.metadata?.engineLoad;
        if (load !== undefined && load !== null && typeof load === 'number') {
          totalLoad += load;
          count++;
        }
      }

      return count > 0 ? totalLoad / count : 50;
    } catch (err) {
      this.logger?.error(`[FuelAdvisorService] Error computing engine load: ${err.message}`);
      return 50; // Fallback
    }
  }
}
