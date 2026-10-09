import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase, supabaseAdmin, redisClient } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

// How many times a single on-chain event may fail handling before it is
// dead-lettered. Failures abort the scan (so the checkpoint is NOT advanced and
// the event is retried on the next poll) until this limit is reached; after
// that the event is skipped so one poison event cannot wedge the monitor.
const DEFAULT_MAX_EVENT_RETRIES = 5;

const ESCROW_ABI = [
  'event BookingCreated(uint256 indexed bookingId, address indexed customer, address indexed driver, uint256 amount)',
  'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingCancelled(uint256 indexed bookingId, address indexed customer, uint256 refundAmount)',
  'event BookingStarted(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event CancellationPenaltyApplied(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address customer, uint256 refundAmount)',
  'event BookingDisputed(uint256 indexed bookingId, address indexed raisedBy)',
  'event DisputeResolved(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)',
  'event WithdrawalReady(uint256 indexed bookingId, address indexed recipient, uint256 amount)',
  'event Withdrawn(address indexed recipient, uint256 amount)',
  'event EmergencyRecovered(address indexed recipient, uint256 amount)',
  'event RelayerUpdated(address indexed newRelayer)',
  // Legacy / simulated events for backward compatibility
  'event PaymentReceived(address indexed driver, uint256 amount, uint256 timestamp)',
  'event InsuranceClaimApproved(uint256 indexed claimId, uint256 amount)',
  'event InsuranceClaimRejected(uint256 indexed claimId, string reason)',
  'event GeofenceBreach(uint256 indexed shipmentId, address driver)',
  'event BalanceUpdateFailed(address indexed wallet, string reason)',
  'event SmartContractRevert(bytes indexed txHash, string reason)',
];

class BlockchainMonitor {
  constructor(deps = {}) {
    this.rpcUrl = deps.rpcUrl || process.env.POLYGON_RPC_URL;
    this.contractAddress = deps.contractAddress || process.env.ESCROW_CONTRACT_ADDRESS;
    this.alertRouter = deps.alertRouter;
    this.metricsService = deps.metricsService;
    this.escalationHandler = deps.escalationHandler;
    this.checkpointStore = deps.checkpointStore || null;
    this.provider = deps.provider || null;
    this.contract = deps.contract || null;
    this.isListening = false;
    this.isScanning = false;
    this.lastBlockScanned = 0;
    this.lastBlockHash = null;
    this.lastSuccessfulScan = null;
    this.lastError = null;
    this.pollTimer = null;
    this.processedEventKeys = new Set();
    // eventKey -> consecutive handling failures (only events that failed are tracked).
    this.eventFailureCounts = new Map();
    this.maxEventRetries = Number.isInteger(deps.maxEventRetries) && deps.maxEventRetries > 0
      ? deps.maxEventRetries
      : (Number.parseInt(process.env.BLOCKCHAIN_EVENT_MAX_RETRIES, 10) > 0
          ? Number.parseInt(process.env.BLOCKCHAIN_EVENT_MAX_RETRIES, 10)
          : DEFAULT_MAX_EVENT_RETRIES);
    this.eventHandlers = {};
    // BLOCKCHAIN_MONITOR_START_BLOCK is the first block to scan (inclusive).
    // Store it as-is; we will set lastBlockScanned = startBlock - 1 so that
    // the first scanBlockRange call includes startBlock itself.
    this.startBlock = deps.startBlock !== undefined
      ? deps.startBlock
      : (process.env.BLOCKCHAIN_MONITOR_START_BLOCK
          ? parseInt(process.env.BLOCKCHAIN_MONITOR_START_BLOCK, 10)
          : (process.env.BLOCKCHAIN_START_BLOCK
              ? parseInt(process.env.BLOCKCHAIN_START_BLOCK, 10)
              : null));
    this.reorgRewindBlocks = deps.reorgRewindBlocks !== undefined
      ? deps.reorgRewindBlocks
      : parseInt(process.env.BLOCKCHAIN_REORG_REWIND_BLOCKS || '12', 10);
  }

  async initialize() {
    return measureExecution('BlockchainMonitor.initialize', async () => {
      this.rpcUrl = this.rpcUrl || process.env.POLYGON_RPC_URL;
      this.contractAddress = this.contractAddress || process.env.ESCROW_CONTRACT_ADDRESS;

      if (!this.rpcUrl || !this.contractAddress) {
        logger.warn('[BlockchainMonitor] RPC URL or contract address not configured. Monitoring disabled.');
        return false;
      }

      try {
        if (!this.provider) {
          this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
        }
        if (!this.contract) {
          this.contract = new ethers.Contract(this.contractAddress, ESCROW_ABI, this.provider);
        }

        const currentBlock = await this.provider.getBlockNumber();
        const checkpoint = await this.loadCheckpoint();

        let startFromBlock = null;

        if (checkpoint && checkpoint.blockNumber !== undefined && checkpoint.blockNumber !== null) {
          // Checkpoint hash must exist before we trust it. A null hash means it was
          // never verified — treat it as untrusted and rewind conservatively.
          if (!checkpoint.blockHash) {
            const rewindTo = Math.max(0, checkpoint.blockNumber - this.reorgRewindBlocks);
            logger.warn(
              `[BlockchainMonitor] Checkpoint at block ${checkpoint.blockNumber} has no verified hash. Rewinding ${this.reorgRewindBlocks} blocks to ${rewindTo} to be safe.`
            );
            startFromBlock = rewindTo;
          } else if (checkpoint.blockNumber <= currentBlock && typeof this.provider.getBlock === 'function') {
            // Reorg safety: verify that the checkpoint block hash still matches canonical chain.
            try {
              const chainBlock = await this.provider.getBlock(checkpoint.blockNumber);
              if (chainBlock && chainBlock.hash && chainBlock.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
                const rewindTo = Math.max(0, checkpoint.blockNumber - this.reorgRewindBlocks);
                logger.warn(
                  `[BlockchainMonitor] Reorg detected at block ${checkpoint.blockNumber}! Checkpoint hash ${checkpoint.blockHash} !== chain hash ${chainBlock.hash}. Rewinding ${this.reorgRewindBlocks} blocks to ${rewindTo}.`
                );
                startFromBlock = rewindTo;
              } else {
                logger.info(`[BlockchainMonitor] Resuming from checkpoint block: ${checkpoint.blockNumber}`);
                startFromBlock = checkpoint.blockNumber;
              }
            } catch (err) {
              // Cannot verify hash — rewind conservatively; do not trust unverified checkpoint.
              const rewindTo = Math.max(0, checkpoint.blockNumber - this.reorgRewindBlocks);
              logger.warn(`[BlockchainMonitor] Error verifying block hash at checkpoint (${err.message}). Rewinding to ${rewindTo}.`);
              startFromBlock = rewindTo;
            }
          } else {
            logger.info(`[BlockchainMonitor] Resuming from checkpoint block: ${checkpoint.blockNumber}`);
            startFromBlock = checkpoint.blockNumber;
          }
        } else if (this.startBlock !== null && this.startBlock !== undefined) {
          // BLOCKCHAIN_MONITOR_START_BLOCK is the first block to scan (inclusive).
          // Set lastBlockScanned to startBlock - 1 so the next scan begins at startBlock.
          logger.info(`[BlockchainMonitor] Using configured start block: ${this.startBlock}`);
          startFromBlock = Math.max(0, this.startBlock - 1);
        } else {
          // No checkpoint and no configured start block: begin at current head.
          startFromBlock = currentBlock;
        }

        this.lastBlockScanned = startFromBlock;
        logger.info(`[BlockchainMonitor] Initialized. Current block: ${currentBlock}, initial scan from after block: ${startFromBlock}`);
        return true;
      } catch (err) {
        logger.error('[BlockchainMonitor] Initialization failed:', err.message);
        this.lastError = err.message;
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

      if (!this.provider || !this.contract) {
        logger.error('[BlockchainMonitor] Provider or contract not initialized. Cannot start listening.');
        return;
      }

      try {
        this.setupEventHandlers();

        // Historical backfill: scan from lastBlockScanned up to current chain head.
        // The checkpoint is only advanced if the full scan and all handlers succeed.
        // A failed backfill (RPC error, or an event whose handler failed) must NOT
        // leave the monitor stopped: the cursor is left untouched and the polling
        // loop started below retries the same range on its next tick.
        if (this.provider && typeof this.provider.getBlockNumber === 'function') {
          try {
            const currentBlock = await this.provider.getBlockNumber();
            if (currentBlock > this.lastBlockScanned) {
              logger.info(`[BlockchainMonitor] Performing historical backfill from block ${this.lastBlockScanned + 1} to ${currentBlock}...`);
              // scanBlockRange throws on failure — if it throws we do NOT save checkpoint.
              await this.scanBlockRange(this.lastBlockScanned + 1, currentBlock);
              // Only fetch block hash and save checkpoint after a successful full scan.
              let blockHash = null;
              if (typeof this.provider.getBlock === 'function') {
                const block = await this.provider.getBlock(currentBlock).catch(() => null);
                blockHash = block?.hash || null;
              }
              // Only persist if we have a valid block hash; a null hash must not be persisted.
              if (blockHash) {
                await this.saveCheckpoint(currentBlock, blockHash);
              } else {
                // Update in-memory cursor but do not persist an unverified checkpoint.
                this.lastBlockScanned = currentBlock;
                logger.warn('[BlockchainMonitor] Backfill complete but block hash unavailable — in-memory cursor advanced; checkpoint not persisted.');
              }
            }
          } catch (backfillErr) {
            logger.error(`[BlockchainMonitor] Historical backfill failed (${backfillErr.message}); cursor not advanced, polling will retry.`);
            this.lastError = backfillErr.message;
            Sentry.captureException(backfillErr);
          }
        }

        this.isListening = true;
        logger.info('[BlockchainMonitor] Started listening for blockchain events.');

        this.startPollingBlocks();
      } catch (err) {
        logger.error('[BlockchainMonitor] Failed to start listening:', err.message);
        this.lastError = err.message;
        Sentry.captureException(err);
      }
    });
  }

  setupEventHandlers() {
    this.eventHandlers = {
      // Real TruxifyEscrow events
      PaymentReleased: this.handlePaymentReleased.bind(this),
      BookingCancelled: this.handleBookingCancelled.bind(this),
      BookingStarted: this.handleBookingStarted.bind(this),
      BookingDisputed: this.handleBookingDisputed.bind(this),
      DisputeResolved: this.handleDisputeResolved.bind(this),
      BookingCreated: this.handleBookingCreated.bind(this),
      // Legacy / simulated events
      PaymentReceived: this.handlePaymentReceived.bind(this),
      InsuranceClaimApproved: this.handleInsuranceClaimApproved.bind(this),
      InsuranceClaimRejected: this.handleInsuranceClaimRejected.bind(this),
      GeofenceBreach: this.handleGeofenceBreach.bind(this),
      BalanceUpdateFailed: this.handleBalanceUpdateFailed.bind(this),
      SmartContractRevert: this.handleSmartContractRevert.bind(this),
    };
  }

  startPollingBlocks() {
    if (this.pollTimer) {
      return;
    }

    if (!this.provider) {
      logger.warn('[BlockchainMonitor] Provider not initialized. Cannot start polling blocks.');
      return;
    }

    const pollInterval = parseInt(process.env.BLOCKCHAIN_POLL_INTERVAL_MS || '12000', 10);

    this.pollTimer = setInterval(async () => {
      if (this.isScanning) {
        logger.warn('[BlockchainMonitor] Previous block scan still in progress. Skipping interval tick to avoid duplicate event processing.');
        return;
      }

      try {
        if (!this.isListening || !this.provider || typeof this.provider.getBlockNumber !== 'function') return;

        this.isScanning = true;
        const currentBlock = await this.provider.getBlockNumber();

        if (currentBlock > this.lastBlockScanned) {
          // Reorg check: verify block hash at the current checkpoint during normal polling.
          if (this.lastBlockHash && typeof this.provider.getBlock === 'function') {
            try {
              const checkpointChainBlock = await this.provider.getBlock(this.lastBlockScanned);
              if (
                checkpointChainBlock &&
                checkpointChainBlock.hash &&
                checkpointChainBlock.hash.toLowerCase() !== this.lastBlockHash.toLowerCase()
              ) {
                const rewindTo = Math.max(0, this.lastBlockScanned - this.reorgRewindBlocks);
                logger.warn(
                  `[BlockchainMonitor] Reorg detected during polling at block ${this.lastBlockScanned}! Rewinding ${this.reorgRewindBlocks} blocks to ${rewindTo}.`
                );
                this.lastBlockScanned = rewindTo;
                this.lastBlockHash = null;
                // Reorg-rewound events may be orphaned: they were stored under old canonical
                // hashes. Their (txHash, logIndex) keys remain in processedEventKeys so they
                // are NOT re-inserted, which is correct — we only re-scan canonical blocks.
              }
            } catch (hashErr) {
              logger.warn(`[BlockchainMonitor] Polling reorg check failed: ${hashErr.message}. Proceeding conservatively.`);
            }
          }

          // Scan from current lastBlockScanned (which may have been rewound above).
          const fromBlock = this.lastBlockScanned + 1;
          if (fromBlock > currentBlock) return; // nothing new after rewind

          // scanBlockRange throws on failure — the checkpoint is only advanced on full success.
          await this.scanBlockRange(fromBlock, currentBlock);

          let blockHash = null;
          if (typeof this.provider.getBlock === 'function') {
            const block = await this.provider.getBlock(currentBlock).catch(() => null);
            blockHash = block?.hash || null;
          }

          // Only persist checkpoint with a valid, verified block hash.
          if (blockHash) {
            await this.saveCheckpoint(currentBlock, blockHash);
          } else {
            this.lastBlockScanned = currentBlock;
            logger.warn('[BlockchainMonitor] Block hash unavailable — in-memory cursor advanced; checkpoint not persisted.');
          }
        }
      } catch (err) {
        logger.error('[BlockchainMonitor] Polling error:', err.message);
        this.lastError = err.message;
        Sentry.captureException(err);
        // lastBlockScanned is NOT advanced on error — the next tick will retry from the same position.
      } finally {
        this.isScanning = false;
      }
    }, pollInterval);
  }

  async scanBlockRange(fromBlock, toBlock) {
    return measureExecution('BlockchainMonitor.scanBlockRange', async () => {
      if (fromBlock > toBlock) return;
      if (!this.provider || typeof this.provider.getLogs !== 'function') {
        logger.warn('[BlockchainMonitor] provider.getLogs not available. Skipping log scan.');
        return;
      }

      // Any error here propagates to the caller; the caller must NOT advance the
      // checkpoint if this throws.
      const CHUNK_SIZE = 500;
      for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
        const filter = {
          fromBlock: start,
          toBlock: end,
        };
        if (this.contractAddress) {
          filter.address = this.contractAddress;
        }
        const logs = await this.provider.getLogs(filter);

        for (const log of logs) {
          await this.processLog(log);
        }
      }

      this.metricsService?.recordBlockScan(toBlock - fromBlock + 1);
      this.lastSuccessfulScan = new Date().toISOString();
    });
  }

  /**
   * Atomically check whether this event key was already processed.
   *
   * The in-memory Set is only populated AFTER a successful DB insert (in storeEvent),
   * so it cannot produce race-condition false-positives during parallel replays.
   * DB lookup is the authoritative deduplication gate.
   */
  async isEventProcessed(eventKey, txHash, logIndex) {
    // Fast path: already confirmed in this process lifetime.
    if (this.processedEventKeys.has(eventKey)) {
      return true;
    }

    // Injectable deduplication store (tests / custom persistence).
    if (this.checkpointStore?.isEventProcessed) {
      const exists = await this.checkpointStore.isEventProcessed(txHash, logIndex);
      if (exists) {
        this.processedEventKeys.add(eventKey);
        return true;
      }
    }

    // Authoritative DB check.
    const client = supabaseAdmin || supabase;
    if (client?.from && txHash) {
      try {
        const { data, error } = await client
          .from('blockchain_monitoring_events')
          .select('id')
          .eq('data->>txHash', txHash)
          .eq('data->>logIndex', String(logIndex))
          .limit(1);

        if (!error && data && data.length > 0) {
          this.processedEventKeys.add(eventKey);
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  /**
   * Parse, de-duplicate and handle one on-chain log.
   *
   * Error contract (this is what keeps the checkpoint honest):
   *   - A log that cannot be DECODED is permanent and not event-specific work we
   *     can retry, so it is logged and skipped.
   *   - A failure while HANDLING a decoded event (persisting it, routing the alert,
   *     escalating) is re-thrown so scanBlockRange() rejects and the caller does
   *     NOT advance the checkpoint; the event is retried on the next poll.
   *   - After `maxEventRetries` consecutive failures the event is dead-lettered
   *     (logged + reported to Sentry) and skipped so a poison event cannot wedge
   *     the monitor forever.
   */
  async processLog(log) {
    let parsed;
    try {
      const iface = new ethers.Interface(ESCROW_ABI);
      parsed = iface.parseLog(log);
    } catch (err) {
      logger.error('[BlockchainMonitor] Log parsing error:', err.message);
      return;
    }

    if (!parsed) return;

    const txHash = log.transactionHash;
    const logIndex = log.index !== undefined ? log.index : (log.logIndex ?? 0);
    const eventKey = `${txHash}:${logIndex}`;

    if (await this.isEventProcessed(eventKey, txHash, logIndex)) {
      logger.debug(`[BlockchainMonitor] Event ${eventKey} already processed. Skipping duplicate.`);
      return;
    }

    const handler = this.eventHandlers[parsed.name];
    if (!handler) return;

    const priorFailures = this.eventFailureCounts.get(eventKey) ?? 0;
    if (priorFailures >= this.maxEventRetries) {
      logger.warn(`[BlockchainMonitor] Event ${eventKey} (${parsed.name}) was dead-lettered after ${priorFailures} failed attempts. Skipping.`);
      return;
    }

    try {
      await handler(parsed.args, log);
      this.eventFailureCounts.delete(eventKey);
    } catch (err) {
      const attempts = priorFailures + 1;
      this.eventFailureCounts.set(eventKey, attempts);

      if (attempts < this.maxEventRetries) {
        logger.error(
          `[BlockchainMonitor] Handling ${parsed.name} ${eventKey} failed (attempt ${attempts}/${this.maxEventRetries}): ${err.message}. ` +
          'Aborting scan so the checkpoint is not advanced; the event will be retried.'
        );
        throw err;
      }

      logger.error(
        `[BlockchainMonitor] Handling ${parsed.name} ${eventKey} failed ${attempts} times (${err.message}). ` +
        'Dead-lettering the event so it cannot block the monitor.'
      );
      Sentry.captureException(err, { extra: { eventKey, eventName: parsed.name, attempts } });
    }
  }

  // ── Real Escrow Handlers ──────────────────────────────────────────────────

  async handlePaymentReleased(args, log) {
    const [bookingId, driver, amount] = args;
    const alert = {
      type: 'PAYMENT_RELEASED',
      severity: 'LOW',
      bookingId: bookingId.toString(),
      driver,
      amount: amount.toString(),
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordPaymentEvent?.('success');
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
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
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
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
  }

  async handleBookingDisputed(args, log) {
    const [bookingId, raisedBy] = args;
    const alert = {
      type: 'BOOKING_DISPUTED',
      severity: 'HIGH',
      bookingId: bookingId.toString(),
      raisedBy,
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.escalationHandler?.escalate(alert);
    await this.storeEvent(alert, log);
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
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
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
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
  }

  // ── Legacy / Simulated Handlers ──────────────────────────────────────────

  async handlePaymentReceived(args, log) {
    const [driver, amount, timestamp] = args;

    const alert = {
      type: 'PAYMENT_RECEIVED',
      severity: 'MEDIUM',
      driver,
      amount: amount.toString(),
      timestamp: parseInt(timestamp, 10),
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordPaymentEvent?.('success');
  }

  async handleInsuranceClaimApproved(args, log) {
    const [claimId, amount] = args;

    const alert = {
      type: 'INSURANCE_CLAIM_APPROVED',
      severity: 'MEDIUM',
      claimId: claimId.toString(),
      amount: amount.toString(),
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordInsuranceEvent?.('approved');
  }

  async handleInsuranceClaimRejected(args, log) {
    const [claimId, reason] = args;

    const alert = {
      type: 'INSURANCE_CLAIM_REJECTED',
      severity: 'HIGH',
      claimId: claimId.toString(),
      reason,
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);

    if (alert.severity === 'HIGH' || alert.severity === 'CRITICAL') {
      await this.escalationHandler?.escalate(alert);
    }
    await this.storeEvent(alert, log);
    this.metricsService?.recordInsuranceEvent?.('rejected');
  }

  async handleGeofenceBreach(args, log) {
    const [shipmentId, driver] = args;

    const alert = {
      type: 'GEOFENCE_BREACH',
      severity: 'HIGH',
      shipmentId: shipmentId.toString(),
      driver,
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.escalationHandler?.escalate(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordGeofenceBreach?.();
  }

  async handleBalanceUpdateFailed(args, log) {
    const [wallet, reason] = args;

    const alert = {
      type: 'BALANCE_UPDATE_FAILED',
      severity: 'CRITICAL',
      wallet,
      reason,
      txHash: log.transactionHash,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.escalationHandler?.escalate(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordBalanceUpdateFailure?.();
  }

  async handleSmartContractRevert(args, log) {
    const [txHash, reason] = args;

    const alert = {
      type: 'SMART_CONTRACT_REVERT',
      severity: 'CRITICAL',
      txHash: '0x' + (txHash ? txHash.slice(2).padEnd(64, '0') : ''.padEnd(64, '0')),
      reason,
      logIndex: log.index !== undefined ? log.index : (log.logIndex ?? 0),
      blockNumber: log.blockNumber,
      timestamp: new Date().toISOString(),
    };
    alert.eventKey = `${alert.txHash}:${alert.logIndex}`;

    await this.alertRouter?.route(alert);
    await this.escalationHandler?.escalate(alert);
    await this.storeEvent(alert, log);
    this.metricsService?.recordContractRevert?.();
  }

  // ── Event & Checkpoint Persistence ───────────────────────────────────────

  async storeEvent(alert, _log) {
    const eventKey = alert.eventKey || `${alert.txHash}:${alert.logIndex ?? 0}`;

    if (this.checkpointStore?.storeEvent) {
      await this.checkpointStore.storeEvent(alert);
      // Only add to in-memory set AFTER successful persistence (atomic deduplication).
      this.processedEventKeys.add(eventKey);
      return;
    }

    const client = supabaseAdmin || supabase;
    if (client?.from) {
      try {
        // supabase-js reports PostgREST/network failures by RETURNING { error }, it
        // does not throw. Ignoring it would mark an un-persisted event as processed.
        const result = await client
          .from('blockchain_monitoring_events')
          .insert([{
            type: alert.type,
            severity: alert.severity,
            data: alert,
            created_at: new Date().toISOString(),
          }]);
        if (result?.error) {
          throw new Error(result.error.message || 'Failed to insert blockchain monitoring event');
        }
        // Only mark as processed AFTER the DB insert succeeds (atomic deduplication).
        this.processedEventKeys.add(eventKey);
      } catch (err) {
        logger.error('[BlockchainMonitor] Failed to store event:', err.message);
        // Do NOT add to processedEventKeys — the event was not persisted;
        // the next scan/replay will correctly retry it.
        throw err;
      }
    } else {
      // No persistence available — still mark to avoid duplicate handler calls
      // within this process session.
      this.processedEventKeys.add(eventKey);
    }
  }

  async saveCheckpoint(blockNumber, blockHash) {
    // Refuse to persist a checkpoint without a verified block hash to prevent
    // future restarts from trusting an unverified position.
    if (!blockHash) {
      logger.warn('[BlockchainMonitor] saveCheckpoint called with null blockHash — refusing to persist unverified checkpoint.');
      this.lastBlockScanned = blockNumber;
      return;
    }

    this.lastBlockScanned = blockNumber;
    this.lastBlockHash = blockHash;
    this.lastSuccessfulScan = new Date().toISOString();

    if (this.checkpointStore?.saveCheckpoint) {
      await this.checkpointStore.saveCheckpoint(blockNumber, blockHash);
      return;
    }

    const client = supabaseAdmin || supabase;
    if (client?.from) {
      try {
        const result = await client
          .from('blockchain_monitoring_events')
          .insert([{
            type: 'SCAN_CHECKPOINT',
            severity: 'LOW',
            data: { blockNumber, blockHash, updatedAt: new Date().toISOString() },
            created_at: new Date().toISOString(),
          }]);
        if (result?.error) {
          throw new Error(result.error.message || 'Failed to insert scan checkpoint');
        }
      } catch (err) {
        logger.warn('[BlockchainMonitor] Failed to persist checkpoint to DB:', err.message);
      }
    }

    if (redisClient?.set) {
      try {
        await redisClient.set('truxify:blockchain:scan_checkpoint', JSON.stringify({ blockNumber, blockHash }));
      } catch (_) {}
    }
  }

  async loadCheckpoint() {
    if (this.checkpointStore?.loadCheckpoint) {
      return await this.checkpointStore.loadCheckpoint();
    }

    const client = supabaseAdmin || supabase;
    if (client?.from) {
      try {
        const { data, error } = await client
          .from('blockchain_monitoring_events')
          .select('data')
          .eq('type', 'SCAN_CHECKPOINT')
          .order('created_at', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0 && data[0]?.data?.blockNumber !== undefined) {
          return {
            blockNumber: Number(data[0].data.blockNumber),
            blockHash: data[0].data.blockHash || null,
          };
        }
      } catch (err) {
        logger.warn('[BlockchainMonitor] Failed to load checkpoint from DB:', err.message);
      }
    }

    if (redisClient?.get) {
      try {
        const val = await redisClient.get('truxify:blockchain:scan_checkpoint');
        if (val) {
          const parsed = JSON.parse(val);
          if (parsed.blockNumber !== undefined) {
            return {
              blockNumber: Number(parsed.blockNumber),
              blockHash: parsed.blockHash || null,
            };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  async getHealth() {
    let currentChainHead = null;
    let blockLag = null;

    if (this.provider && typeof this.provider.getBlockNumber === 'function') {
      try {
        currentChainHead = await this.provider.getBlockNumber();
        if (this.lastBlockScanned !== null && this.lastBlockScanned !== undefined) {
          blockLag = Math.max(0, currentChainHead - this.lastBlockScanned);
        }
      } catch (err) {
        this.lastError = err.message;
      }
    }

    return {
      status: this.isListening ? 'running' : 'stopped',
      running: this.isListening,
      lastScannedBlock: this.lastBlockScanned,
      currentChainHead,
      blockLag,
      lastSuccessfulScan: this.lastSuccessfulScan || null,
      lastError: this.lastError || null,
    };
  }

  async stopListening() {
    this.isListening = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('[BlockchainMonitor] Stopped listening for blockchain events.');
  }
}

export default BlockchainMonitor;
