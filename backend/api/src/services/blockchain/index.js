import Multicall3Service from './multicall3Service.js';
import BatchCallBuilder from './batchCallBuilder.js';
import BlockchainMonitor from './blockchainMonitor.js';
import AlertRouter, { SEVERITY_LEVELS, ALERT_CHANNELS } from './alertRouter.js';
import EscalationHandler, { ESCALATION_LEVELS, ESCALATION_THRESHOLDS } from './escalationHandler.js';
import BlockchainMetrics from './blockchainMetrics.js';
import {
  startEventListener,
  stopEventListener,
  isEventListenerActive,
  getLastProcessedBlock,
  saveLastProcessedBlock,
  handlePaymentLockedEvent,
  handlePaymentReleasedEvent,
  handleDisputeOpenedEvent,
} from './eventListener.js';

import { RpcProviderManager, CIRCUIT_STATES, defaultRpcManager } from './rpcProviderManager.js';

const defaultBlockchainMetrics = new BlockchainMetrics();
const defaultEscalationHandler = new EscalationHandler({});

export {
  Multicall3Service,
  BatchCallBuilder,
  BlockchainMonitor,
  AlertRouter,
  SEVERITY_LEVELS,
  ALERT_CHANNELS,
  EscalationHandler,
  ESCALATION_LEVELS,
  ESCALATION_THRESHOLDS,
  BlockchainMetrics,
  defaultBlockchainMetrics,
  defaultEscalationHandler,
  startEventListener,
  stopEventListener,
  isEventListenerActive,
  getLastProcessedBlock,
  saveLastProcessedBlock,
  handlePaymentLockedEvent,
  handlePaymentReleasedEvent,
  handleDisputeOpenedEvent,
  RpcProviderManager,
  CIRCUIT_STATES,
  defaultRpcManager,
};

