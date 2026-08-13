/**
 * Backfill / rebuild script for the unified order-event pipeline.
 *
 * Historical orders predate the event outbox, so their original events cannot
 * be reconstructed. This script therefore:
 *
 *   1. Backfills the SINGLE authoritative read model (`orders_read_model`)
 *      directly from the authoritative `orders` table.
 *   2. Primes the outbox with ONE event per order that has no outbox rows yet,
 *      so pre-existing orders also flow through Kafka once. (Documented
 *      limitation: that event reflects the order's current row — e.g. an
 *      already-cancelled order gets an ORDER_CANCELLED snapshot — not the
 *      original creation/update history.)
 *
 * The operation is idempotent and safe to re-run:
 *   - read-model upserts are on conflict(order_id), never delete orders
 *   - outbox priming is guarded by `not exists` per aggregate
 *   - orders that already have events are left untouched
 *
 * Run with:  node scripts/backfill-orders.js
 * DEPTH NOTE: this module lives at backend/kafka/scripts/, so api/src imports
 * use the ../../api/src depth (enforced by test/smoke.test.js).
 */
import dotenv from 'dotenv';
import logger from '../../api/src/middleware/logger.js';
import { supabaseAdmin } from '../../api/src/config/db.js';

dotenv.config();

/**
 * Executes the backfill RPC (supabase/migrations/.../event_outbox...sql
 * `backfill_order_events()`). Injectable client for unit tests.
 *
 * @param {{client?: object}} [options]
 * @returns {Promise<{orders: number, read_models_written: number, outbox_events_enqueued: number}>}
 */
export async function backfillOrderReadModels({ client } = {}) {
  const supabaseClient = client || supabaseAdmin;

  const { data, error } = await supabaseClient.rpc('backfill_order_events');
  if (error) {
    throw new Error(`backfill_order_events failed: ${error.message}`);
  }

  const result = data && typeof data === 'object'
    ? data
    : { orders: 0, read_models_written: 0, outbox_events_enqueued: 0 };

  logger.info('✅ Order read-model backfill complete', result);
  return result;
}

async function main() {
  try {
    const result = await backfillOrderReadModels();
    logger.info('Summary:', result);
  } catch (error) {
    logger.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('backfill-orders.js')) {
  main();
}
