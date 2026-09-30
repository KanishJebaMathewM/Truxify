/**
 * @fileoverview Core fleet analytics service orchestrating metrics aggregation.
 */

import { supabaseAdmin, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
    aggregateDriverUtilization,
    aggregateRouteEfficiency,
    aggregateDeliveryPerformance
} from '../lib/metricsAggregator.js';
import { formatDashboardMetrics } from '../lib/reportGenerator.js';

const CACHE_PREFIX = 'fleet:analytics:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Gets the complete dashboard metrics for a fleet manager.
 * @param {string} fleetManagerId 
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {Promise<object>}
 */
export async function getDashboardMetrics(fleetManagerId, startDate, endDate) {
    const cacheKey = `${CACHE_PREFIX}${fleetManagerId}:${startDate}:${endDate}`;

    // Check Redis cache
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            logger.warn({ err }, 'Fleet analytics cache read failed');
        }
    }

    // Fetch all aggregations in parallel
    const [utilization, routeEfficiency, deliveryPerf] = await Promise.all([
        aggregateDriverUtilization(fleetManagerId, startDate, endDate),
        aggregateRouteEfficiency(fleetManagerId, startDate, endDate),
        aggregateDeliveryPerformance(fleetManagerId, startDate, endDate)
    ]);

    // Calculate summary metrics
    const totalDistance = utilization.reduce((sum, d) => sum + d.totalDistanceKm, 0);
    const totalActiveHours = utilization.reduce((sum, d) => sum + d.activeHours, 0);
    const totalRevenue = routeEfficiency.reduce((sum, r) => sum + r.revenue, 0);
    const totalFuelCost = routeEfficiency.reduce((sum, r) => sum + r.fuelCostPaisa, 0);

    const rawMetrics = {
        totalDrivers: utilization.length,
        activeDrivers: utilization.filter(d => d.activeHours > 0).length,
        utilizationPct: deliveryPerf.onTimePct, // Simplified for dashboard
        onTimePct: deliveryPerf.onTimePct,
        averageRating: deliveryPerf.averageRating,
        totalTrips: deliveryPerf.total,
        totalDistanceKm: Math.round(totalDistance * 100) / 100,
        totalActiveHours: Math.round(totalActiveHours * 100) / 100,
        totalRevenue,
        totalFuelCost
    };

    const dashboard = {
        summary: formatDashboardMetrics(rawMetrics),
        driverUtilization: utilization,
        routeEfficiency: routeEfficiency.slice(0, 50), // Top 50 routes
        deliveryPerformance: deliveryPerf,
        generatedAt: new Date().toISOString()
    };

    // Cache result
    if (redisClient && redisClient.status === 'ready') {
        try {
            await redisClient.set(cacheKey, JSON.stringify(dashboard), 'EX', CACHE_TTL_SECONDS);
        } catch (err) {
            logger.warn({ err }, 'Fleet analytics cache write failed');
        }
    }

    return dashboard;
}

/**
 * Gets real-time fleet status (active drivers, current trips).
 * @param {string} fleetManagerId 
 * @returns {Promise<object>}
 */
export async function getRealtimeFleetStatus(fleetManagerId) {
    if (!supabaseAdmin) return { activeDrivers: 0, activeTrips: 0 };

    try {
        // Count active drivers (pinged in last 15 minutes)
        const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        const { count: activeDrivers, error: driverErr } = await supabaseAdmin
            .from('driver_locations')
            .select('*', { count: 'exact', head: true })
            .eq('fleet_manager_id', fleetManagerId)
            .eq('is_active', true)
            .gte('last_updated_at', fifteenMinAgo);

        if (driverErr) throw driverErr;

        // Count active trips
        const { count: activeTrips, error: tripErr } = await supabaseAdmin
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('fleet_manager_id', fleetManagerId)
            .in('status', ['en_route_pickup', 'loaded', 'en_route_dropoff']);

        if (tripErr) throw tripErr;

        return {
            activeDrivers: activeDrivers || 0,
            activeTrips: activeTrips || 0,
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        logger.error({ err, fleetManagerId }, 'Failed to get realtime fleet status');
        return { activeDrivers: 0, activeTrips: 0 };
    }
}

/**
 * Generates predictive insights (placeholder for ML integration).
 * @param {string} fleetManagerId 
 * @returns {Promise<object>}
 */
export async function getPredictiveInsights(fleetManagerId) {
    // In production, this would call the ML service
    // For now, return rule-based insights

    const metrics = await getDashboardMetrics(
        fleetManagerId,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
        new Date().toISOString()
    );

    const insights = [];

    if (metrics.summary.fleetOverview.utilizationRate < 60) {
        insights.push({
            type: 'warning',
            title: 'Low Fleet Utilization',
            message: `Your fleet utilization is ${metrics.summary.fleetOverview.utilizationRate}%. Consider reducing fleet size or increasing load acceptance.`,
            impact: 'high'
        });
    }

    if (metrics.summary.performance.onTimeDeliveryPct < 80) {
        insights.push({
            type: 'critical',
            title: 'Poor On-Time Performance',
            message: `Only ${metrics.summary.performance.onTimeDeliveryPct}% of deliveries are on time. Review route planning and driver scheduling.`,
            impact: 'high'
        });
    }

    if (metrics.summary.performance.averageRating && metrics.summary.performance.averageRating < 4.0) {
        insights.push({
            type: 'warning',
            title: 'Low Customer Ratings',
            message: `Average rating is ${metrics.summary.performance.averageRating}. Consider driver training programs.`,
            impact: 'medium'
        });
    }

    return {
        insights,
        generatedAt: new Date().toISOString()
    };
}

export default {
    getDashboardMetrics,
    getRealtimeFleetStatus,
    getPredictiveInsights
};
