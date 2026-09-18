import { ethers } from 'ethers';
import axios from 'axios';
import { supabaseAdmin, redisClient } from '../../config/db.js';
import { sendFcmNotification } from '../notificationService.js';
import logger from '../../middleware/logger.js';

const LAST_PROCESSED_BLOCK_KEY = 'truxify:blockchain:last_processed_block';

const ESCROW_EVENTS_ABI = [
  'event PaymentLocked(uint256 indexed bookingId, uint256 amount, address customer)',
  'event PaymentReleased(uint256 indexed bookingId, uint256 amount, address driver)',
  'event DisputeOpened(uint256 indexed bookingId, string reason)',
];

let isListening = false;
let currentProvider = null;
let currentContract = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
const MAX_RECONNECT_DELAY_MS = 30000;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Detach listeners and release the provider from a previous session. Called
 * before every (re)connect and on stop so a reconnect can never leave the old
 * contract's listeners attached — otherwise the same on-chain event would be
 * processed twice (duplicate order updates / notifications).
 */
function cleanupCurrentListener() {
  if (currentContract) {
    try {
      currentContract.removeAllListeners();
    } catch (err) {
      logger.warn(`[EventListener] Failed to remove contract listeners: ${err.message}`);
    }
    currentContract = null;
  }

  if (currentProvider) {
    try {
      if (typeof currentProvider.destroy === 'function') {
        currentProvider.destroy();
      }
    } catch (err) {
      logger.warn(`[EventListener] Failed to destroy provider: ${err.message}`);
    }
    currentProvider = null;
  }
}

export async function getLastProcessedBlock() {
  if (!redisClient) return null;
  try {
    const val = await redisClient.get(LAST_PROCESSED_BLOCK_KEY);
    return val ? Number.parseInt(String(val), 10) : null;
  } catch (err) {
    logger.warn(`[EventListener] Redis get last block error: ${err.message}`);
    return null;
  }
}

export async function saveLastProcessedBlock(blockNumber) {
  if (!redisClient || !blockNumber) return;
  try {
    await redisClient.set(LAST_PROCESSED_BLOCK_KEY, String(blockNumber));
  } catch (err) {
    logger.warn(`[EventListener] Redis save last block error: ${err.message}`);
  }
}

/**
 * Serialize live blockchain events so database synchronization and cursor updates
 * cannot overlap across concurrent ethers event callbacks.
 */
let liveEventQueue = Promise.resolve();
export function enqueueLiveEvent(handler, eventPayload) {
  liveEventQueue = liveEventQueue
    .then(() => handler(eventPayload))
    .catch((err) => {
      logger.error(`[EventListener] Live event processing error: ${err.message}`);
    });

  return liveEventQueue;
}

export async function handlePaymentLockedEvent({ bookingId, amount, customer, blockNumber }) {
  const orderIdStr = String(bookingId);
  logger.info(`[EventListener] Processing PaymentLocked for bookingId: ${orderIdStr}, amount: ${amount}`);

  let dbSyncFailed = false;

  if (supabaseAdmin) {
    try {
      const { error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'locked',
          escrow_status: 'locked',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`);

      if (orderError) throw orderError;

      const { error: tripError } = await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'locked',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);

      if (tripError) throw tripError;
    } catch (err) {
      dbSyncFailed = true;
      logger.error(`[EventListener] Error updating PaymentLocked in DB: ${err.message}`);
    }
  }

  if (dbSyncFailed) {
    return { success: false, event: 'PaymentLocked', bookingId: orderIdStr };
  }

  if (blockNumber) {
    await saveLastProcessedBlock(blockNumber);
  }

  return { success: true, event: 'PaymentLocked', bookingId: orderIdStr };
}

export async function handlePaymentReleasedEvent({ bookingId, amount, driver, blockNumber }) {
  const orderIdStr = String(bookingId);
  logger.info(`[EventListener] Processing PaymentReleased for bookingId: ${orderIdStr}, amount: ${amount}`);

  let customerId = null;
  let driverId = null;
  let dbSyncFailed = false;

  if (supabaseAdmin) {
    try {
      const { data: order, error: orderLookupError } = await supabaseAdmin
        .from('orders')
        .select('id, customer_id, driver_id, order_display_id, total_amount')
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`)
        .maybeSingle();

      if (orderLookupError) throw orderLookupError;

      if (order) {
        customerId = order.customer_id;
        driverId = order.driver_id;

        const { error: orderUpdateError } = await supabaseAdmin
          .from('orders')
          .update({
            payment_status: 'released',
            escrow_status: 'payment_released',
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (orderUpdateError) throw orderUpdateError;
      }

      const { error: tripError } = await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'released',
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);

      if (tripError) throw tripError;
    } catch (err) {
      dbSyncFailed = true;
      logger.error(`[EventListener] Error updating PaymentReleased in DB: ${err.message}`);
    }
  }

  if (dbSyncFailed) {
    return { success: false, event: 'PaymentReleased', bookingId: orderIdStr };
  }

  // Trigger FCM Notifications to Customer and Driver
  const amountFormatted = amount ? `₹${amount}` : 'freight amount';
  if (customerId) {
    await sendFcmNotification(customerId, {
      title: 'Payment Released ✓',
      body: `Payment of ${amountFormatted} for order ${orderIdStr} has been released to the driver.`,
    }, { orderId: orderIdStr, type: 'payment_released' });
  }

  if (driverId) {
    await sendFcmNotification(driverId, {
      title: 'Payment Received 💰',
      body: `Payment of ${amountFormatted} for trip ${orderIdStr} has been credited to your wallet.`,
    }, { orderId: orderIdStr, type: 'payment_released' });
  }

  if (blockNumber) {
    await saveLastProcessedBlock(blockNumber);
  }

  return { success: true, event: 'PaymentReleased', bookingId: orderIdStr };
}

export async function handleDisputeOpenedEvent({ bookingId, reason, blockNumber }) {
  const orderIdStr = String(bookingId);
  logger.info(`[EventListener] Processing DisputeOpened for bookingId: ${orderIdStr}, reason: ${reason}`);

  let dbSyncFailed = false;

  if (supabaseAdmin) {
    try {
      const { error: orderError } = await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'disputed',
          escrow_status: 'disputed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`);

      if (orderError) throw orderError;

      const { error: tripError } = await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'disputed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);

      if (tripError) throw tripError;
    } catch (err) {
      dbSyncFailed = true;
      logger.error(`[EventListener] Error updating DisputeOpened in DB: ${err.message}`);
    }
  }

  if (dbSyncFailed) {
    return { success: false, event: 'DisputeOpened', bookingId: orderIdStr };
  }

  // Fire n8n dispute resolution webhook
  const n8nWebhookUrl = process.env.N8N_DISPUTE_WEBHOOK_URL;
  if (n8nWebhookUrl) {
    try {
      await axios.post(n8nWebhookUrl, {
        event: 'DisputeOpened',
        bookingId: orderIdStr,
        reason: reason || 'Customer/Driver raised dispute on-chain',
        timestamp: new Date().toISOString(),
      }, { timeout: 5000 });
      logger.info(`[EventListener] Successfully fired n8n dispute webhook for ${orderIdStr}`);
    } catch (err) {
      logger.error(`[EventListener] Failed to fire n8n dispute webhook: ${err.message}`);
    }
  }

  if (blockNumber) {
    await saveLastProcessedBlock(blockNumber);
  }

  return { success: true, event: 'DisputeOpened', bookingId: orderIdStr };
}

export async function queryAndProcessHistoricalEvents(fromBlock, toBlock) {
  if (!currentContract || fromBlock > toBlock) return;
  logger.info(`[EventListener] Querying historical events from block ${fromBlock} to ${toBlock}...`);

  try {
    const lockedEvents = await currentContract.queryFilter(currentContract.filters.PaymentLocked(), fromBlock, toBlock);
    for (const ev of lockedEvents) {
      const result = await handlePaymentLockedEvent({
        bookingId: ev.args?.bookingId,
        amount: ev.args?.amount,
        customer: ev.args?.customer,
        blockNumber: ev.blockNumber,
      });
      if (!result?.success) return;
    }

    const releasedEvents = await currentContract.queryFilter(currentContract.filters.PaymentReleased(), fromBlock, toBlock);
    for (const ev of releasedEvents) {
      const result = await handlePaymentReleasedEvent({
        bookingId: ev.args?.bookingId,
        amount: ev.args?.amount,
        driver: ev.args?.driver,
        blockNumber: ev.blockNumber,
      });
      if (!result?.success) return;
    }

    const disputeEvents = await currentContract.queryFilter(currentContract.filters.DisputeOpened(), fromBlock, toBlock);
    for (const ev of disputeEvents) {
      const result = await handleDisputeOpenedEvent({
        bookingId: ev.args?.bookingId,
        reason: ev.args?.reason,
        blockNumber: ev.blockNumber,
      });
      if (!result?.success) return;
    }
  } catch (err) {
    logger.error(`[EventListener] Historical event processing error: ${err.message}`);
  }
}

export async function startEventListener() {
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;

  if (!rpcUrl || !contractAddress) {
    logger.warn('[EventListener] POLYGON_RPC_URL or ESCROW_CONTRACT_ADDRESS missing — skipping listener setup.');
    return false;
  }

  // Guard against a duplicate start creating a second contract with its own
  // listeners on the same provider (every event would fire twice).
  if (isListening) {
    logger.warn('[EventListener] startEventListener called while already listening — ignoring.');
    return true;
  }

  clearReconnectTimer();

  try {
    cleanupCurrentListener();

    currentProvider = new ethers.JsonRpcProvider(rpcUrl);
    currentContract = new ethers.Contract(contractAddress, ESCROW_EVENTS_ABI, currentProvider);

    // Resume from last processed block if present in Redis
    const lastBlock = await getLastProcessedBlock();
    if (lastBlock) {
      const currentBlock = await currentProvider.getBlockNumber();
      if (currentBlock > lastBlock) {
        await queryAndProcessHistoricalEvents(lastBlock + 1, currentBlock);
      }
    }

    // Subscribe to live contract events. Handlers are serialized through the queue
    // so overlapping callbacks cannot mutate DB state or the block cursor concurrently.
    currentContract.on('PaymentLocked', (bookingId, amount, customer, event) => {
      void enqueueLiveEvent(handlePaymentLockedEvent, {
        bookingId,
        amount,
        customer,
        blockNumber: event?.log?.blockNumber ?? event?.blockNumber,
      });
    });

    currentContract.on('PaymentReleased', (bookingId, amount, driver, event) => {
      void enqueueLiveEvent(handlePaymentReleasedEvent, {
        bookingId,
        amount,
        driver,
        blockNumber: event?.log?.blockNumber ?? event?.blockNumber,
      });
    });

    currentContract.on('DisputeOpened', (bookingId, reason, event) => {
      void enqueueLiveEvent(handleDisputeOpenedEvent, {
        bookingId,
        reason,
        blockNumber: event?.log?.blockNumber ?? event?.blockNumber,
      });
    });

    isListening = true;
    reconnectAttempt = 0;
    logger.info(`[EventListener] Connected & listening to contract at ${contractAddress} on ${rpcUrl}`);
    return true;
  } catch (err) {
    logger.error(`[EventListener] Failed to start listener: ${err.message}`);
    isListening = false;
    scheduleReconnect();
    return false;
  }
}

function scheduleReconnect() {
  reconnectAttempt++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY_MS);
  logger.info(`[EventListener] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
  // Keep a handle to the pending timer so stopEventListener() can cancel it;
  // otherwise a shutdown could be undone by a reconnect that fires moments
  // later and re-opens the listener.
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startEventListener();
  }, delay);
}

export function stopEventListener() {
  clearReconnectTimer();
  cleanupCurrentListener();
  isListening = false;
  reconnectAttempt = 0;
  logger.info('[EventListener] Event listener stopped.');
}

export function isEventListenerActive() {
  return isListening;
}
