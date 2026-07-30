import { eventBus } from '../core/events/index.js';
import { awardReputationPoints } from '../services/reputation.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { ContextPropagator } from '../core/telemetry/ContextPropagator.js';
import spanFactory from '../core/telemetry/SpanFactory.js';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';


eventBus.subscribe('rating:submitted', async (payload) => {
  const parentCtx = payload?.metadata?.traceContext
    ? ContextPropagator.extractFromEventPayload(payload)
    : undefined;

  const span = spanFactory.startEventHandlerSpan('rating.submitted', 'reputation-subscriber', {
    attributes: {
      'event.type': 'rating:submitted',
    },
  });

  try {
    const runCtx = parentCtx || context.active();

    await context.with(trace.setSpan(runCtx, span), async () => {
      const { driverWallet, stars, orderDisplayId } = payload?.payload || payload;
  
      if (!driverWallet) {
        logger.warn(`[reputation] Event 'rating:submitted' for order ${orderDisplayId} lacks a driver wallet address — skipping on-chain update.`);
        return;
      }

      try {
        logger.info(`[reputation] Processing 'rating:submitted' event for order ${orderDisplayId}`);
        await awardReputationPoints(driverWallet, stars);
      } catch (repErr) {
        logger.error('[reputation] On-chain reputation update failed from event bus:', repErr.message);
        
        // Attempt to log failure in DB for retry worker
        try {
          const orderRepository = new OrderRepository(supabase);
          await orderRepository.insertReputationFailure({
            driver_wallet: driverWallet,
            stars,
            failed_at: new Date().toISOString(),
            retry_count: 0,
            last_error: repErr.message,
          });
        } catch (dbErr) {
          logger.error('[reputation] Failed to log reputation failure from event bus:', dbErr.message);
        }
      }
    });

    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    spanFactory.recordError(span, error);
  } finally {
    span.end();
  }
});
