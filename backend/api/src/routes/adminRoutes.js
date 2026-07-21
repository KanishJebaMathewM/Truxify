/**
 * @openapi
 * components:
 *   schemas:
 *     AdminDashboardResponse:
 *       type: object
 *       properties:
 *         active_drivers:
 *           type: integer
 *         pending_orders:
 *           type: integer
 *         total_revenue_today:
 *           type: number
 */

import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';

const router = express.Router();

/**
 * @openapi
 * /api/v1/admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Get admin dashboard stats
 *     description: Returns aggregated dashboard statistics including active drivers count, pending orders count, and today's total revenue. Requires admin role.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminDashboardResponse'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - admin role required
 */
router.get('/dashboard', authenticate, userLimiter, requirePolicy('admin:view-dashboard'), async (req, res) => {
  try {
    const { count: activeDrivers, error: driversErr } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'driver')
      .eq('is_active', true);
      
    if (driversErr) {
      logger.error('Error fetching active drivers:', driversErr.message);
      return res.status(500).json({ error: 'Failed to fetch drivers count.' });
    }

    const { count: pendingOrders, error: ordersErr } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
      
    if (ordersErr) {
      logger.error('Error fetching pending orders:', ordersErr.message);
      return res.status(500).json({ error: 'Failed to fetch pending orders.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayOrders, error: revErr } = await supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', today.toISOString());
      
    if (revErr) {
      logger.error('Error fetching revenue:', revErr.message);
      return res.status(500).json({ error: 'Failed to fetch revenue.' });
    }
    
    const totalRevenue = todayOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);

    res.json({
      active_drivers: activeDrivers || 0,
      pending_orders: pendingOrders || 0,
      total_revenue_today: totalRevenue
    });
  } catch (err) {
    logger.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
