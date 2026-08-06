import { supabase, redisClient, mongoDb, firebaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

import { OrderRepository } from '../repositories/orderRepository.js';
import OracleService from '../oracle/OracleService.js';
import VerificationService from '../services/verification/VerificationService.js';
import { TrackingTokenService } from '../services/trackingTokenService.js';

import { OrderTimelineService } from '../services/order/orderTimelineService.js';
import { OrderValidationService } from '../services/order/orderValidationService.js';
import { OrderMilestoneService } from '../services/order/orderMilestoneService.js';
import { OrderNotificationService } from '../services/order/orderNotificationService.js';
import { BidAcceptanceService } from '../services/order/bidAcceptanceService.js';
import { DeliveryVerificationService } from '../services/order/deliveryVerificationService.js';
import { OrderLifecycleService } from '../services/order/orderLifecycleService.js';

import {
  buildDepositTx,
  submitEscrowRefund,
  recordDepositTx,
  submitEscrowRefund,
  confirmEscrowRefund,
} from '../services/escrow.js';

const orderRepository = new OrderRepository(supabase);

const oracleService = new OracleService({ orderRepository });
const verificationService = new VerificationService({ orderRepository, oracleService });

const orderTimelineService = new OrderTimelineService(orderRepository);
const orderValidationService = new OrderValidationService({ supabase, logger });
const orderNotificationService = new OrderNotificationService(orderRepository);

const bidAcceptanceService = new BidAcceptanceService({
  orderRepository,
  buildDepositTxFn: buildDepositTx,
  recordDepositTxFn: recordDepositTx,
  escrowRefundFn: submitEscrowRefund,
  logger,
});

const trackingTokenService = new TrackingTokenService({ supabase, logger });

const deliveryVerificationService = new DeliveryVerificationService(orderRepository, {
  trackingTokenService,
});

const orderMilestoneService = new OrderMilestoneService({
  orderRepository,
  orderValidationService,
  orderTimelineService,
  orderNotificationService,
  trackingTokenService,
});

const orderLifecycleService = new OrderLifecycleService({
  orderRepository,
  orderTimelineService,
  bidAcceptanceService,
  trackingTokenService,
});

export {
  supabase,
  redisClient,
  mongoDb,
  firebaseAdmin,
  logger,

  orderRepository,
  oracleService,
  verificationService,

  orderTimelineService,
  orderValidationService,
  orderMilestoneService,
  orderNotificationService,
  bidAcceptanceService,
  trackingTokenService,
  deliveryVerificationService,
  orderLifecycleService,

  buildDepositTx,
  submitEscrowRefund,
  recordDepositTx,
  submitEscrowRefund,
  confirmEscrowRefund,
};
