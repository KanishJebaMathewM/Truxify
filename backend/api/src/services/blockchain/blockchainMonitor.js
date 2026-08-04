import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const PAYMENT_RECEIVED_EVENT = 'PaymentReceived(address indexed driver, uint256 amount, uint256 timestamp)';
const INSURANCE_CLAIM_APPROVED_EVENT = 'InsuranceClaimApproved(uint256 indexed claimId, uint256 amount)';
const INSURANCE_CLAIM_REJECTED_EVENT = 'InsuranceClaimRejected(uint256 indexed claimId, string reason)';
const GEOFENCE_BREACH_EVENT = 'GeofenceBreach(uint256 indexed shipmentId, address driver)';
const BALANCE_UPDATE_FAILED_EVENT = 'BalanceUpdateFailed(address indexed wallet, string reason)';
const SMART_CONTRACT_REVERT_EVENT = 'SmartContractRevert(bytes indexed txHash, string reason)';

const ESCROW_ABI = [
  'event PaymentReceived(address indexed driver, uint256 amount, uint256 timestamp)',
  'event InsuranceClaimApproved(uint256 indexed claimId, uint256 amount)',
  'event InsuranceClaimRejected(uint256 indexed claimId, string reason)',
  'event GeofenceBreach(uint256 indexed shipmentId, address driver)',
  'event BalanceUpdateFailed(address indexed wallet, string reason)',
  'event SmartContractRevert(bytes indexed txHash, string reason)',
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
      'PaymentReceived': this.handlePaymentReceived.bind(this),
      'InsuranceClaimApproved': this.handleInsuranceClaimApproved.bind(this),
      'InsuranceClaimRejected': this.handleInsuranceClaimRejected.bind(this),
      'GeofenceBreach': this.handleGeofenceBreach.bind(this),
      'BalanceUpdateFailed': this.handleBalanceUpdateFailed.bind(this),
      'SmartContractRevert': this.handleSmartContractRevert.bind(this),
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

  async handlePaymentReceived(args, log) {
    const [driver, amount, timestamp] = args;

    const alert = {
      type: 'PAYMENT_RECEIVED',
      severity: 'MEDIUM',
      driver,
      amount: amount.toString(),
      timestamp: parseInt(timestamp),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordPaymentEvent('success');
  }

  async handleInsuranceClaimApproved(args, log) {
    const [claimId, amount] = args;

    const alert = {
      type: 'INSURANCE_CLAIM_APPROVED',
      severity: 'MEDIUM',
      claimId: claimId.toString(),
      amount: amount.toString(),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordInsuranceEvent('approved');
  }

  async handleInsuranceClaimRejected(args, log) {
    const [claimId, reason] = args;

    const alert = {
      type: 'INSURANCE_CLAIM_REJECTED',
      severity: 'HIGH',
      claimId: claimId.toString(),
      reason,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordInsuranceEvent('rejected');

    if (alert.severity === 'HIGH' || alert.severity === 'CRITICAL') {
      await this.escalationHandler?.escalate(alert);
    }
  }

  async handleGeofenceBreach(args, log) {
    const [shipmentId, driver] = args;

    const alert = {
      type: 'GEOFENCE_BREACH',
      severity: 'HIGH',
      shipmentId: shipmentId.toString(),
      driver,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordGeofenceBreach();
    await this.escalationHandler?.escalate(alert);
  }

  async handleBalanceUpdateFailed(args, log) {
    const [wallet, reason] = args;

    const alert = {
      type: 'BALANCE_UPDATE_FAILED',
      severity: 'CRITICAL',
      wallet,
      reason,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: new Date().toISOString(),
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordBalanceUpdateFailure();
    await this.escalationHandler?.escalate(alert);
  }

  async handleSmartContractRevert(args, log) {
    const [txHash, reason] = args;

    const alert = {
      type: 'SMART_CONTRACT_REVERT',
      severity: 'CRITICAL',
      txHash: '0x' + txHash.slice(2).padEnd(64, '0'),
      reason,
      blockNumber: log.blockNumber,
      timestamp: new Date().toISOString(),
    };

    await this.storeEvent(alert);
    await this.alertRouter?.route(alert);
    this.metricsService?.recordContractRevert();
    await this.escalationHandler?.escalate(alert);
  }

  async storeEvent(alert) {
    try {
      await supabase
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
