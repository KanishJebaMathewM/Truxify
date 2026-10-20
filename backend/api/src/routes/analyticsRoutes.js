/**
 * @fileoverview Fleet analytics dashboard endpoints.
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
    getDashboardMetrics,
    getRealtimeFleetStatus,
    getPredictiveInsights
} from '../services/fleetAnalyticsService.js';
import { generateCSV, generateHTMLReport } from '../lib/reportGenerator.js';
import logger from '../middleware/logger.js';

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Returns comprehensive dashboard metrics.
 */
router.get('/dashboard', authenticate, requireRole(['fleet_manager', 'admin']), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end = endDate || new Date().toISOString();

        const metrics = await getDashboardMetrics(req.user.id, start, end);

        res.json({ success: true, ...metrics });
    } catch (err) {
        logger.error({ err }, 'GET /analytics/dashboard error');
        res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
    }
});

/**
 * GET /api/analytics/realtime
 * Returns real-time fleet status (WebSocket polling alternative).
 */
router.get('/realtime', authenticate, requireRole(['fleet_manager', 'admin']), async (req, res) => {
    try {
        const status = await getRealtimeFleetStatus(req.user.id);
        res.json({ success: true, ...status });
    } catch (err) {
        logger.error({ err }, 'GET /analytics/realtime error');
        res.status(500).json({ error: 'Failed to fetch realtime status' });
    }
});

/**
 * GET /api/analytics/insights
 * Returns predictive insights and recommendations.
 */
router.get('/insights', authenticate, requireRole(['fleet_manager', 'admin']), async (req, res) => {
    try {
        const insights = await getPredictiveInsights(req.user.id);
        res.json({ success: true, ...insights });
    } catch (err) {
        logger.error({ err }, 'GET /analytics/insights error');
        res.status(500).json({ error: 'Failed to fetch insights' });
    }
});

/**
 * GET /api/analytics/export/csv
 * Exports driver utilization data as CSV.
 */
router.get('/export/csv', authenticate, requireRole(['fleet_manager', 'admin']), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end = endDate || new Date().toISOString();

        const metrics = await getDashboardMetrics(req.user.id, start, end);

        const csvContent = generateCSV(
            metrics.driverUtilization,
            ['driverId', 'totalDistanceKm', 'activeHours', 'idleHours', 'utilizationPct']
        );

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=fleet_utilization_${Date.now()}.csv`);
        res.send(csvContent);
    } catch (err) {
        logger.error({ err }, 'GET /analytics/export/csv error');
        res.status(500).json({ error: 'Failed to export CSV' });
    }
});

/**
 * GET /api/analytics/export/html
 * Generates printable HTML report.
 */
router.get('/export/html', authenticate, requireRole(['fleet_manager', 'admin']), async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const end = endDate || new Date().toISOString();

        const metrics = await getDashboardMetrics(req.user.id, start, end);

        const htmlReport = generateHTMLReport({
            title: 'Fleet Analytics Report',
            generatedAt: metrics.generatedAt,
            summary: {
                'Total Drivers': metrics.summary.fleetOverview.totalDrivers,
                'Active Drivers': metrics.summary.fleetOverview.activeDrivers,
                'On-Time %': `${metrics.summary.performance.onTimeDeliveryPct}%`,
                'Avg Rating': metrics.summary.performance.averageRating || 'N/A'
            },
            tables: [
                {
                    title: 'Driver Utilization',
                    columns: [
                        { key: 'driverId', label: 'Driver ID' },
                        { key: 'totalDistanceKm', label: 'Distance (km)' },
                        { key: 'activeHours', label: 'Active Hours' },
                        { key: 'utilizationPct', label: 'Utilization %', format: 'percent' }
                    ],
                    data: metrics.driverUtilization
                }
            ]
        });

        res.setHeader('Content-Type', 'text/html');
        res.send(htmlReport);
    } catch (err) {
        logger.error({ err }, 'GET /analytics/export/html error');
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

export default router;
