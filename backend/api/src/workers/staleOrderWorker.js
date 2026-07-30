import cron from 'node-cron';
import logger from '../middleware/logger.js';
import { supabase } from '../config/db.js';
import { sendPushNotification } from '../services/notificationService.js';
import { WorkerTracer } from '../core/telemetry/WorkerTracer.js';
import spanFactory from '../core/telemetry/SpanFactory.js';

let staleOrderWorkerTask = null;

export const startStaleOrderWorker = () => {
  if (staleOrderWorkerTask) {
    logger.info('[StaleOrderWorker] Stale order cleanup cron job already scheduled.');
    return staleOrderWorkerTask;
  }

  const tracedHandler = WorkerTracer.wrapCronJob('stale-order-worker', async () => {
    logger.info('[StaleOrderWorker] Starting cleanup of stale pending orders...');
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Find all pending orders created more than 24 hours ago
      const { data: staleOrders, error: fetchError } = await supabase
        .from('orders')
        .select('id, customer_id, order_display_id')
        .eq('status', 'pending')
        .lt('created_at', twentyFourHoursAgo);

      if (fetchError) {
        logger.error(`[StaleOrderWorker] Error fetching stale orders: ${fetchError.message}`);
        return;
      }

      if (!staleOrders || staleOrders.length === 0) {
        logger.info('[StaleOrderWorker] No stale orders found.');
        return;
      }

      logger.info(`[StaleOrderWorker] Found ${staleOrders.length} stale pending orders. Cancelling...`);

      spanFactory.getActiveSpan()?.setAttributes({
        'stale_orders.count': staleOrders.length,
      });

      for (const order of staleOrders) {
        // Update status to cancelled
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('id', order.id);

        if (updateError) {
          logger.error(`[StaleOrderWorker] Failed to cancel order ${order.id}: ${updateError.message}`);
          continue;
        }

        // Cancel associated load offers
        await supabase
          .from('load_offers')
          .update({ status: 'cancelled' })
          .eq('order_display_id', order.order_display_id);

        // Send a notification to the customer
        try {
          await sendPushNotification(
            order.customer_id,
            'Order Cancelled',
            'Your order was cancelled because it received no accepted bids within 24 hours. Please try posting again.',
            'ORDER_CANCELLED',
            { orderId: order.id }
          );
          logger.info(`[StaleOrderWorker] Cancelled order ${order.id} and notified customer ${order.customer_id}.`);
        } catch (notifyErr) {
          logger.warn(`[StaleOrderWorker] Cancelled order ${order.id}, but failed to notify customer ${order.customer_id}: ${notifyErr.message}`);
        }
      }
      
      logger.info('[StaleOrderWorker] Cleanup of stale pending orders completed.');
    } catch (err) {
      logger.error(`[StaleOrderWorker] Unexpected error during cleanup: ${err.message}`);
    }
  }, { schedule: '0 * * * *' });

  // Run every hour at minute 0
  staleOrderWorkerTask = cron.schedule('0 * * * *', tracedHandler);

  logger.info('[StaleOrderWorker] Stale order cleanup cron job scheduled (runs every hour).');
  return staleOrderWorkerTask;
};

export const stopStaleOrderWorker = () => {
  if (!staleOrderWorkerTask) return;

  staleOrderWorkerTask.stop();
  staleOrderWorkerTask = null;
  logger.info('[StaleOrderWorker] Stale order cleanup cron job stopped.');
};
