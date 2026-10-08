/**
 * Admin Routes
 * 
 * Handles administrative dashboard metrics, management endpoints,
 * and system oversight. Protected with authentication and admin policies.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/policy.js';
import logger from '../middleware/logger.js';
import { supabase } from '../config/db.js';

const router = express.Router();

/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Get admin dashboard overview metrics
 *     description: Fetches active drivers, pending orders, and revenue statistics with request tracing.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard', authenticate, requirePolicy('admin:read'), async (req, res) => {
  try {
    let activeDrivers = [];
    let pendingOrders = [];
    let revenue = 0;

    // Fetch active drivers
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('driver_details')
          .select('*')
          .eq('is_online', true);
        if (error) throw error;
        activeDrivers = data || [];
      }
    } catch (driversErr) {
      logger.error(
        { requestId: req.requestId, event: 'ADMIN_DRIVERS_FETCH_ERROR', error: driversErr.message },
        'Error fetching active drivers'
      );
    }

    // Fetch pending orders
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('status', 'pending');
        if (error) throw error;
        pendingOrders = data || [];
      }
    } catch (ordersErr) {
      logger.error(
        { requestId: req.requestId, event: 'ADMIN_ORDERS_FETCH_ERROR', error: ordersErr.message },
        'Error fetching pending orders'
      );
    }

    // Fetch revenue
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('transactions')
          .select('amount')
          .eq('status', 'completed');
        if (error) throw error;
        revenue = (data || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
      }
    } catch (revErr) {
      logger.error(
        { requestId: req.requestId, event: 'ADMIN_REVENUE_FETCH_ERROR', error: revErr.message },
        'Error fetching revenue'
      );
    }

    logger.info({ event: 'ADMIN_DASHBOARD_FETCHED', requestId: req.requestId }, 'Admin dashboard data retrieved.');
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        activeDriversCount: activeDrivers.length,
        pendingOrdersCount: pendingOrders.length,
        totalRevenue: revenue,
        activeDrivers,
        pendingOrders,
      },
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'ADMIN_DASHBOARD_ERROR', error: err },
      'Admin dashboard error'
    );
    return res.status(500).json({
      success: false,
      error: 'Internal server error while fetching admin dashboard.',
    });
  }
});

export default router;
