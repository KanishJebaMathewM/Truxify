import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const BOOKING_CREATED_EVENT = 'event BookingCreated(uint256 indexed bookingId, address indexed customer, address indexed driver, uint256 amount)';
const PAYMENT_RELEASED_EVENT = 'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 amount)';
const BOOKING_CANCELLED_EVENT = 'event BookingCancelled(uint256 indexed bookingId, address indexed customer, uint256 refundAmount)';
const BOOKING_STARTED_EVENT = 'event BookingStarted(uint256 indexed bookingId, address indexed driver, uint256 amount)';
const CANCELLATION_PENALTY_APPLIED_EVENT = 'event CancellationPenaltyApplied(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address customer, uint256 refundAmount)';
const BOOKING_DISPUTED_EVENT = 'event BookingDisputed(uint256 indexed bookingId, address indexed raisedBy)';
const DISPUTE_RESOLVED_EVENT = 'event DisputeResolved(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)';
const WITHDRAWAL_READY_EVENT = 'event WithdrawalReady(uint256 indexed bookingId, address indexed recipient, uint256 amount)';
const WITHDRAWN_EVENT = 'event Withdrawn(address indexed recipient, uint256 amount)';
const EMERGENCY_RECOVERED_EVENT = 'event EmergencyRecovered(address indexed recipient, uint256 amount)';
const RELAYER_UPDATED_EVENT = 'event RelayerUpdated(address indexed newRelayer)';

const ESCROW_ABI = [
  BOOKING_CREATED_EVENT,
  PAYMENT_RELEASED_EVENT,
  BOOKING_CANCELLED_EVENT,
  BOOKING_STARTED_EVENT,
  CANCELLATION_PENALTY_APPLIED_EVENT,
  BOOKING_DISPUTED_EVENT,
  DISPUTE_RESOLVED_EVENT,
  WITHDRAWAL_READY_EVENT,
  WITHDRAWN_EVENT,
  EMERGENCY_RECOVERED_EVENT,
  RELAYER_UPDATED_EVENT,
];

class BlockchainMonitor {
  constructor(deps = {}) {
    this.rpcUrl = process.env.POLYGON_RPC_URL;
    this.contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    this.alertRouter = deps.alertRouter;
    this.metricsService = deps.metricsService;
    this.escalationHandler = deps.escalationHandler;
    this.provider = null;
    this.contract = null;
    this.isListening = false;
    this.lastBlockScanned = 0;
    this.eventHandlers = {};
  }

  async initialize() {
    return measureExecution('BlockchainMonitor.initialize', async () => {
      if (!this.rpcUrl || !this.contractAddress) {
        logger.warn('[BlockchainMonitor] RPC URL or contract address not configured. Monitoring disabled.');
        return false;
      }

      try {
        this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
        this.contract = new ethers.Contract(this.contractAddress, ESCROW_ABI, this.provider);

        const blockNumber = await this.provider.getBlockNumber();
        this.lastBlockScanned = blockNumber;

        logger.info(`[BlockchainMonitor] Initialized. Current block: ${blockNumber}`);
        return true;
      } catch (err) {
        logger.error('[BlockchainMonitor] Initialization failed:', err.message);
        Sentry.captureException(err);
        return false;
      }
    });
  }

  async startListening() {
    return measureExecution('BlockchainMonitor.startListening', async () => {
      if (this.isListening) {
        logger.warn('[BlockchainMonitor] Already listening for events.');
        return;
      }

      if (!this.contract) {
        logger.error('[BlockchainMonitor] Contract not initialized. Cannot start listening.');
        return;
      }

      try {
        this.setupEventHandlers();
        this.isListening = true;
        logger.info('[BlockchainMonitor] Started listening for blockchain events.');

        this.startPollingBlocks();
      } catch (err) {
        logger.error('[BlockchainMonitor] Failed to start listening:', err.message);
        Sentry.captureException(err);
      }
    });
  }

  setupEventHandlers() {
    this.eventHandlers = {
      'BookingCreated': this.handleBookingCreated.bind(this),
      'PaymentReleased': this.handlePaymentReleased.bind(this),
      'BookingCancelled': this.handleBookingCancelled.bind(this),
      'BookingStarted': this.handleBookingStarted.bind(this),
      'CancellationPenaltyApplied': this.handleCancellationPenaltyApplied.bind(this),
      'BookingDisputed': this.handleBookingDisputed.bind(this),
      'DisputeResolved': this.handleDisputeResolved.bind(this),
      'WithdrawalReady': this.handleWithdrawalReady.bind(this),
      'Withdrawn': this.handleWithdrawn.bind(this),
      'EmergencyRecovered': this.handleEmergencyRecovered.bind(this),
      'RelayerUpdated': this.handleRelayerUpdated.bind(this),
    };
  }

  startPollingBlocks() {
    const pollInterval = parseInt(process.env.BLOCKCHAIN_POLL_INTERVAL_MS || '12000', 10);

    setInterval(async () => {
      try {
        if (!this.isListening || !this.provider) return;

        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock > this.lastBlockScanned) {
          await this.scanBlockRange(this.lastBlockScanned + 1, currentBlock);
          this.lastBlockScanned = currentBlock;
        }
      } catch (err) {
        logger.error('[BlockchainMonitor] Polling error:', err.message);
        Sentry.captureException(err);
      }
    }, pollInterval);
  }

  async scanBlockRange(fromBlock, toBlock) {
    return measureExecution('BlockchainMonitor.scanBlockRange', async () => {
      try {
        const logs = await this.provider.getLogs({
          address: this.contractAddress,
          fromBlock,
          toBlock,
        });

        for (const log of logs) {
          await this.processLog(log);
        }

        this.metricsService?.recordBlockScan(toBlock - fromBlock + 1);
      } catch (err) {
        logger.error(`[BlockchainMonitor] Error scanning blocks ${fromBlock}-${toBlock}:`, err.message);
        this.metricsService?.recordBlockScanError();
        Sentry.captureException(err);
      }
    });
  }

  async processLog(log) {
    try {
      const iface = new ethers.Interface(ESCROW_ABI);
      const parsed = iface.parseLog(log);

      if (!parsed) return;

      const handler = this.eventHandlers[parsed.name];
      if (handler) {
        await handler(parsed.args, log);
      }
    } catch (err) {
      logger.error('[BlockchainMonitor] Log parsing error:', err.message);
    }
  }

  async handleBookingCreated(args, log) {
    const [bookingId, customer, driver, amount] = args;

    const alert = {
      type: 'BOOKING_CREATED',
      severity: 'LOW',
      bookingId: bookingId.toString(),
      customer,
      driver,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async handlePaymentReleased(args, log) {
    const [bookingId, driver, amount] = args;

    const alert = {
      type: 'PAYMENT_RELEASED',
      severity: 'MEDIUM',
      bookingId: bookingId.toString(),
      driver,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordPaymentEvent('success');
  }

  async handleBookingCancelled(args, log) {
    const [bookingId, customer, refundAmount] = args;

    const alert = {
      type: 'BOOKING_CANCELLED',
      severity: 'MEDIUM',
      bookingId: bookingId.toString(),
      customer,
      refundAmount: refundAmount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async handleBookingStarted(args, log) {
    const [bookingId, driver, amount] = args;

    const alert = {
      type: 'BOOKING_STARTED',
      severity: 'LOW',
      bookingId: bookingId.toString(),
      driver,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async handleCancellationPenaltyApplied(args, log) {
    const [bookingId, driver, driverAmount, customer, refundAmount] = args;

    const alert = {
      type: 'CANCELLATION_PENALTY_APPLIED',
      severity: 'MEDIUM',
      bookingId: bookingId.toString(),
      driver,
      driverAmount: driverAmount.toString(),
      customer,
      refundAmount: refundAmount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async handleBookingDisputed(args, log) {
    const [bookingId, raisedBy] = args;

    const alert = {
      type: 'BOOKING_DISPUTED',
      severity: 'HIGH',
      bookingId: bookingId.toString(),
      raisedBy,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    await this.escalationHandler?.escalate(alert);
  }

  async handleDisputeResolved(args, log) {
    const [bookingId, driver, driverAmount, customer, refundAmount] = args;

    const alert = {
      type: 'DISPUTE_RESOLVED',
      severity: 'MEDIUM',
      bookingId: bookingId.toString(),
      driver,
      driverAmount: driverAmount.toString(),
      customer,
      refundAmount: refundAmount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordPaymentEvent('success');
  }

  async handleWithdrawalReady(args, log) {
    const [bookingId, recipient, amount] = args;

    const alert = {
      type: 'WITHDRAWAL_READY',
      severity: 'MEDIUM',
      bookingId: bookingId.toString(),
      recipient,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async handleWithdrawn(args, log) {
    const [recipient, amount] = args;

    const alert = {
      type: 'WITHDRAWN',
      severity: 'MEDIUM',
      recipient,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordPaymentEvent('success');
  }

  async handleEmergencyRecovered(args, log) {
    const [recipient, amount] = args;

    const alert = {
      type: 'EMERGENCY_RECOVERED',
      severity: 'CRITICAL',
      recipient,
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordContractRevert();
    await this.escalationHandler?.escalate(alert);
  }

  async handleRelayerUpdated(args, log) {
    const [newRelayer] = args;

    const alert = {
      type: 'RELAYER_UPDATED',
      severity: 'MEDIUM',
      newRelayer,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
  }

  async storeEvent(alert) {
    try {
      await (supabaseAdmin || supabase)
        .from('blockchain_monitoring_events')
        .insert([{
          type: alert.type,
          severity: alert.severity,
          data: alert,
          created_at: new Date().toISOString(),
        }]);
    } catch (err) {
      logger.error('[BlockchainMonitor] Failed to store event:', err.message);
    }
  }

  async stopListening() {
    this.isListening = false;
    logger.info('[BlockchainMonitor] Stopped listening for blockchain events.');
  }
}

export default BlockchainMonitor;
