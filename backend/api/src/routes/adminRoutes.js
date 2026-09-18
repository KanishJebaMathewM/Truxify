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
 *     StuckWithdrawalResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         driver_id:
 *           type: string
 *         amount:
 *           type: number
 *         status:
 *           type: string
 *         retry_count:
 *           type: integer
 *         settle_attempts:
 *           type: integer
 *         next_retry_at:
 *           type: string
 *         settlement_error:
 *           type: string
 *         dlq_reason:
 *           type: string
 */

import express from 'express';
import { getAdminClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { auditLog } from '../middleware/auditLog.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// Dashboard aggregates span every profile/order, so they must be read with a
// client that bypasses per-row RLS. Fall back to the anon client only when no
// service-role key is configured (e.g. tests), matching the repo convention.
const dashboardDb = getAdminClient();

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
router.get('/dashboard', authenticate, userLimiter, requirePolicy('admin:view-dashboard'), auditLog({ action: 'admin:view-dashboard' }), async (req, res) => {
  try {
    const { count: activeDrivers, error: driversErr } = await dashboardDb
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'driver')
      .eq('is_active', true);
      
    if (driversErr) {
      logger.error({ event: 'ADMIN_DASHBOARD_DRIVERS_ERROR', requestId: req.requestId || req.id, error: driversErr && driversErr.message }, 'Error fetching active drivers');
      return res.status(500).json({ error: 'Failed to fetch drivers count.' });
    }

    const { count: pendingOrders, error: ordersErr } = await dashboardDb
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
      
    if (ordersErr) {
      logger.error({ event: 'ADMIN_DASHBOARD_ORDERS_ERROR', requestId: req.requestId || req.id, error: ordersErr && ordersErr.message }, 'Error fetching pending orders');
      return res.status(500).json({ error: 'Failed to fetch pending orders.' });
    }

    // Compute midnight IST (UTC+5:30) so daily stats align with Indian business day
    const now = new Date();
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    istNow.setUTCHours(0, 0, 0, 0);
    const today = new Date(istNow.getTime() - IST_OFFSET_MS);
    const { data: todayOrders, error: revErr } = await dashboardDb
      .from('orders')
      .select('total_amount')
      .gte('created_at', today.toISOString())
      .in('status', ['delivered', 'payment_released']);
      
    if (revErr) {
      logger.error({ event: 'ADMIN_DASHBOARD_REVENUE_ERROR', requestId: req.requestId || req.id, error: revErr && revErr.message }, 'Error fetching revenue');
      return res.status(500).json({ error: 'Failed to fetch revenue.' });
    }
    
    // total_amount is stored in paisa — divide by 100 for INR display
    const totalRevenue = todayOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0) / 100;

    res.json({
      active_drivers: activeDrivers || 0,
      pending_orders: pendingOrders || 0,
      total_revenue_today: totalRevenue
    });
  } catch (err) {
    logger.error({ event: 'ADMIN_DASHBOARD_ERROR', requestId: req.requestId || req.id, error: err && (err.message || String(err)) }, 'Admin dashboard error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/v1/admin/withdrawals/stuck:
 *   get:
 *     tags: [Admin]
 *     summary: List stuck or DLQ driver withdrawals
 *     description: Returns a list of driver withdrawals that are in DLQ, terminal settlement_failed status, or stuck pending retries.
 *     security:
 *       - BearerAuth: []
 */
router.get('/withdrawals/stuck', authenticate, userLimiter, requirePolicy('admin:manage-finances'), auditLog({ action: 'admin:view-stuck-withdrawals' }), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const { data: withdrawals, error, count } = await dashboardDb
      .from('wallet_transactions')
      .select('id, driver_id, amount, status, retry_count, max_retries, settle_attempts, next_retry_at, payout_attempted_at, settlement_error, dlq_at, dlq_reason, created_at, updated_at', { count: 'exact' })
      .eq('txn_type', 'withdrawal')
      .or('status.eq.settlement_failed,status.eq.dlq,retry_count.gt.0,payout_attempted_at.not.is.null')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ event: 'ADMIN_STUCK_WITHDRAWALS_ERROR', error: error.message }, 'Failed to fetch stuck withdrawals');
      return res.status(500).json({ error: 'Failed to fetch stuck withdrawals.' });
    }

    res.json({
      total: count || (withdrawals ? withdrawals.length : 0),
      limit,
      offset,
      withdrawals: withdrawals || [],
    });
  } catch (err) {
    logger.error({ event: 'ADMIN_STUCK_WITHDRAWALS_ERROR', error: err && err.message }, 'Admin stuck withdrawals error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/v1/admin/withdrawals/:id/retry:
 *   post:
 *     tags: [Admin]
 *     summary: Manually retry a stuck/DLQ withdrawal
 */
router.post('/withdrawals/:id/retry', authenticate, userLimiter, requirePolicy('admin:manage-finances'), auditLog({ action: 'admin:retry-withdrawal' }), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};

    const { data, error } = await dashboardDb.rpc('admin_resolve_dlq_withdrawal', {
      p_withdrawal_id: id,
      p_action: 'retry',
      p_admin_id: req.user?.id || null,
      p_notes: notes || 'Admin initiated manual retry',
    });

    if (error) {
      logger.error({ event: 'ADMIN_RETRY_WITHDRAWAL_ERROR', withdrawalId: id, error: error.message }, 'Failed to retry withdrawal');
      return res.status(500).json({ error: error.message });
    }

    if (data && data.success === false) {
      return res.status(400).json(data);
    }

    if (data?.success === false) {
      return res.status(409).json(data);
    }
    res.json(data || { success: true, message: 'Withdrawal retry scheduled' });
  } catch (err) {
    logger.error({ event: 'ADMIN_RETRY_WITHDRAWAL_ERROR', error: err && err.message }, 'Admin retry withdrawal error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/v1/admin/withdrawals/:id/refund:
 *   post:
 *     tags: [Admin]
 *     summary: Force-refund reserved funds for a stuck withdrawal back to the driver
 */
router.post('/withdrawals/:id/refund', authenticate, userLimiter, requirePolicy('admin:manage-finances'), auditLog({ action: 'admin:refund-withdrawal' }), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};

    const { data, error } = await dashboardDb.rpc('admin_resolve_dlq_withdrawal', {
      p_withdrawal_id: id,
      p_action: 'refund',
      p_admin_id: req.user?.id || null,
      p_notes: notes || 'Admin confirmed payout failed; funds force-refunded',
    });

    if (error) {
      logger.error({ event: 'ADMIN_REFUND_WITHDRAWAL_ERROR', withdrawalId: id, error: error.message }, 'Failed to refund withdrawal');
      return res.status(500).json({ error: error.message });
    }

    if (data && data.success === false) {
      return res.status(400).json(data);
    }

    res.json(data || { success: true, message: 'Withdrawal refunded successfully' });
  } catch (err) {
    logger.error({ event: 'ADMIN_REFUND_WITHDRAWAL_ERROR', error: err && err.message }, 'Admin refund withdrawal error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
