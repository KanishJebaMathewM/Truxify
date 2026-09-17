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
const MAX_RECONNECT_DELAY_MS = 30000;

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

export async function handlePaymentLockedEvent({ bookingId, amount, customer, blockNumber }) {
  const orderIdStr = String(bookingId);
  logger.info(`[EventListener] Processing PaymentLocked for bookingId: ${orderIdStr}, amount: ${amount}`);

  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'locked',
          escrow_status: 'locked',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`);

      await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'locked',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);
    } catch (err) {
      logger.error(`[EventListener] Error updating PaymentLocked in DB: ${err.message}`);
    }
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

  if (supabaseAdmin) {
    try {
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, customer_id, driver_id, order_display_id, total_amount')
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`)
        .maybeSingle();

      if (order) {
        customerId = order.customer_id;
        driverId = order.driver_id;

        await supabaseAdmin
          .from('orders')
          .update({
            payment_status: 'released',
            escrow_status: 'payment_released',
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      }

      await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'released',
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);
    } catch (err) {
      logger.error(`[EventListener] Error updating PaymentReleased in DB: ${err.message}`);
    }
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

  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'disputed',
          escrow_status: 'disputed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},order_display_id.eq.${orderIdStr}`);

      await supabaseAdmin
        .from('trips')
        .update({
          payment_status: 'disputed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${orderIdStr},trip_display_id.eq.${orderIdStr}`);
    } catch (err) {
      logger.error(`[EventListener] Error updating DisputeOpened in DB: ${err.message}`);
    }
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
      await handlePaymentLockedEvent({
        bookingId: ev.args?.bookingId,
        amount: ev.args?.amount,
        customer: ev.args?.customer,
        blockNumber: ev.blockNumber,
      });
    }

    const releasedEvents = await currentContract.queryFilter(currentContract.filters.PaymentReleased(), fromBlock, toBlock);
    for (const ev of releasedEvents) {
      await handlePaymentReleasedEvent({
        bookingId: ev.args?.bookingId,
        amount: ev.args?.amount,
        driver: ev.args?.driver,
        blockNumber: ev.blockNumber,
      });
    }

    const disputeEvents = await currentContract.queryFilter(currentContract.filters.DisputeOpened(), fromBlock, toBlock);
    for (const ev of disputeEvents) {
      await handleDisputeOpenedEvent({
        bookingId: ev.args?.bookingId,
        reason: ev.args?.reason,
        blockNumber: ev.blockNumber,
      });
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

  try {
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

    // Subscribe to live contract events
    currentContract.on('PaymentLocked', (bookingId, amount, customer, event) => {
      handlePaymentLockedEvent({
        bookingId,
        amount,
        customer,
        blockNumber: event?.log?.blockNumber ?? event?.blockNumber,
      });
    });

    currentContract.on('PaymentReleased', (bookingId, amount, driver, event) => {
      handlePaymentReleasedEvent({
        bookingId,
        amount,
        driver,
        blockNumber: event?.log?.blockNumber ?? event?.blockNumber,
      });
    });

    currentContract.on('DisputeOpened', (bookingId, reason, event) => {
      handleDisputeOpenedEvent({
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
    scheduleReconnect();
    return false;
  }
}

function scheduleReconnect() {
  reconnectAttempt++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY_MS);
  logger.info(`[EventListener] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
  setTimeout(() => {
    startEventListener();
  }, delay);
}

export function stopEventListener() {
  if (currentContract) {
    try {
      currentContract.removeAllListeners();
    } catch (_) {}
  }
  isListening = false;
  logger.info('[EventListener] Event listener stopped.');
}

export function isEventListenerActive() {
  return isListening;
}
