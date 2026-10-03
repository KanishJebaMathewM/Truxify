/**
 * @fileoverview Time-series metrics aggregation for fleet analytics.
 * Computes rollups (1-min, 1-hour, 1-day) from raw telemetry data.
 */

import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Aggregates driver utilization metrics for a given time range.
 * @param {string} fleetManagerId 
 * @param {string} startDate - ISO date
 * @param {string} endDate - ISO date
 * @returns {Promise<object[]>}
 */
export async function aggregateDriverUtilization(fleetManagerId, startDate, endDate) {
    if (!supabaseAdmin) return [];

    try {
        // Query aggregated telemetry data
        const { data, error } = await supabaseAdmin
            .from('driver_telemetry_daily')
            .select(`
        driver_id,
        total_distance_km,
        active_hours,
        idle_hours,
        total_pings
      `)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('fleet_manager_id', fleetManagerId);

        if (error) throw error;

        // Group by driver
        const driverMap = new Map();

        for (const row of (data || [])) {
            if (!driverMap.has(row.driver_id)) {
                driverMap.set(row.driver_id, {
                    driverId: row.driver_id,
                    totalDistanceKm: 0,
                    activeHours: 0,
                    idleHours: 0,
                    totalPings: 0,
                    daysTracked: 0
                });
            }

            const driver = driverMap.get(row.driver_id);
            driver.totalDistanceKm += row.total_distance_km || 0;
            driver.activeHours += row.active_hours || 0;
            driver.idleHours += row.idle_hours || 0;
            driver.totalPings += row.total_pings || 0;
            driver.daysTracked += 1;
        }

        // Calculate utilization percentage
        return Array.from(driverMap.values()).map(d => ({
            ...d,
            totalDistanceKm: Math.round(d.totalDistanceKm * 100) / 100,
            activeHours: Math.round(d.activeHours * 100) / 100,
            idleHours: Math.round(d.idleHours * 100) / 100,
            utilizationPct: d.activeHours + d.idleHours > 0
                ? Math.round((d.activeHours / (d.activeHours + d.idleHours)) * 100)
                : 0
        }));
    } catch (err) {
        logger.error({ err, fleetManagerId }, 'Failed to aggregate driver utilization');
        return [];
    }
}

/**
 * Aggregates route efficiency metrics.
 * @param {string} fleetManagerId 
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {Promise<object[]>}
 */
export async function aggregateRouteEfficiency(fleetManagerId, startDate, endDate) {
    if (!supabaseAdmin) return [];

    try {
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
        id,
        driver_id,
        planned_distance_km,
        actual_distance_km,
        fuel_cost_paisa,
        total_amount,
        status,
        completed_at
      `)
            .eq('fleet_manager_id', fleetManagerId)
            .eq('status', 'completed')
            .gte('completed_at', startDate)
            .lte('completed_at', endDate);

        if (error) throw error;

        const routes = (data || []).map(order => {
            const planned = order.planned_distance_km || 0;
            const actual = order.actual_distance_km || 0;
            const deviation = planned > 0 ? ((actual - planned) / planned) * 100 : 0;

            return {
                orderId: order.id,
                driverId: order.driver_id,
                plannedDistanceKm: planned,
                actualDistanceKm: actual,
                deviationPct: Math.round(deviation * 100) / 100,
                fuelCostPaisa: order.fuel_cost_paisa || 0,
                revenue: order.total_amount || 0,
                fuelEfficiency: actual > 0 ? Math.round((order.fuel_cost_paisa || 0) / actual) : 0
            };
        });

        return routes;
    } catch (err) {
        logger.error({ err, fleetManagerId }, 'Failed to aggregate route efficiency');
        return [];
    }
}

/**
 * Aggregates delivery performance (on-time vs delayed).
 * @param {string} fleetManagerId 
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {Promise<object>}
 */
export async function aggregateDeliveryPerformance(fleetManagerId, startDate, endDate) {
    if (!supabaseAdmin) return { onTime: 0, delayed: 0, total: 0, onTimePct: 0 };

    try {
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select('id, estimated_delivery_at, completed_at, customer_rating')
            .eq('fleet_manager_id', fleetManagerId)
            .eq('status', 'completed')
            .gte('completed_at', startDate)
            .lte('completed_at', endDate);

        if (error) throw error;

        let onTime = 0;
        let delayed = 0;
        let totalRating = 0;
        let ratedCount = 0;

        for (const order of (data || [])) {
            if (order.estimated_delivery_at && order.completed_at) {
                const est = new Date(order.estimated_delivery_at).getTime();
                const actual = new Date(order.completed_at).getTime();

                // Consider "on-time" if delivered within 2 hours of estimate
                if (actual <= est + (2 * 60 * 60 * 1000)) {
                    onTime++;
                } else {
                    delayed++;
                }
            }

            if (order.customer_rating) {
                totalRating += order.customer_rating;
                ratedCount++;
            }
        }

        const total = onTime + delayed;

        return {
            onTime,
            delayed,
            total,
            onTimePct: total > 0 ? Math.round((onTime / total) * 100) : 0,
            averageRating: ratedCount > 0 ? Math.round((totalRating / ratedCount) * 10) / 10 : null
        };
    } catch (err) {
        logger.error({ err, fleetManagerId }, 'Failed to aggregate delivery performance');
        return { onTime: 0, delayed: 0, total: 0, onTimePct: 0 };
    }
}
