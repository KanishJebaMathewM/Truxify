// backend/api/src/services/orderLifecycleService.js
import * as orderCreationService from './orderCreationService.js';
import * as orderValidationService from './orderValidationService.js';

/**
 * Creates an order by delegating to the atomic transactional orderCreationService
 * which executes the server-side `create_order_tx` RPC.
 */
export async function createOrder(orderPayload, userId) {
  // 1. Validate payload via validation service
  const validation = orderValidationService.validateOrderPayload(orderPayload);
  if (!validation.isValid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  // 2. Delegate to atomic transaction service (create_order_tx RPC)
  const result = await orderCreationService.createOrder({
    ...orderPayload,
    userId,
    idempotent: true,
  });

  return result;
}
