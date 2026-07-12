import { supabase, redisClient, mongoDb, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

import { OrderRepository } from '../repositories/orderRepository.js';

import { OrderTimelineService } from '../services/order/orderTimelineService.js';
import { OrderValidationService } from '../services/order/orderValidationService.js';
import { OrderMilestoneService } from '../services/order/orderMilestoneService.js';
import { OrderNotificationService } from '../services/order/orderNotificationService.js';
import { BidAcceptanceService } from '../services/order/bidAcceptanceService.js';
import { DeliveryVerificationService } from '../services/order/deliveryVerificationService.js';
import { OrderLifecycleService } from '../services/order/orderLifecycleService.js';

import {
  buildDepositTx,
  escrowRefund,
  recordDepositTx,
  submitEscrowRefund,
  confirmEscrowRefund,
} from '../services/escrow.js';

const orderRepository = new OrderRepository(supabase);

const orderTimelineService = new OrderTimelineService(orderRepository);
const orderValidationService = new OrderValidationService({ supabase, logger });
const orderNotificationService = new OrderNotificationService(orderRepository);

const bidAcceptanceService = new BidAcceptanceService({
  orderRepository,
  buildDepositTxFn: buildDepositTx,
  recordDepositTxFn: recordDepositTx,
  escrowRefundFn: escrowRefund,
  logger,
});

const deliveryVerificationService = new DeliveryVerificationService(orderRepository);

const orderMilestoneService = new OrderMilestoneService({
  orderRepository,
  orderValidationService,
  orderTimelineService,
  orderNotificationService,
});

const orderLifecycleService = new OrderLifecycleService({
  orderRepository,
  orderTimelineService,
  bidAcceptanceService,
});

export {
  supabase,
  redisClient,
  mongoDb,
  firebaseAdmin,
  logger,

  orderRepository,

  orderTimelineService,
  orderValidationService,
  orderMilestoneService,
  orderNotificationService,
  bidAcceptanceService,
  deliveryVerificationService,
  orderLifecycleService,

  buildDepositTx,
  escrowRefund,
  recordDepositTx,
  submitEscrowRefund,
  confirmEscrowRefund,
};
