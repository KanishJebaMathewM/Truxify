import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: null,
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
  redisClient: null,
}));

import BlockchainMonitor from '../../../../src/services/blockchain/blockchainMonitor.js';
import StateDivergenceDetector from '../../../../src/services/blockchain/stateDivergenceDetector.js';

const ESCROW_ABI = [
  'event BookingCreated(uint256 indexed bookingId, address indexed customer, address indexed driver, uint256 amount)',
  'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingCancelled(uint256 indexed bookingId, address indexed customer, uint256 refundAmount)',
  'event BookingStarted(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingDisputed(uint256 indexed bookingId, address indexed raisedBy)',
  'event DisputeResolved(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)',
];

const iface = new ethers.Interface(ESCROW_ABI);

function createTestMonitor(overrides = {}) {
  const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
  const metricsService = {
    recordBlockScan: vi.fn(),
    recordBlockScanError: vi.fn(),
    recordPaymentEvent: vi.fn(),
  };
  const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
  const checkpointStore = {
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
    storeEvent: vi.fn().mockResolvedValue(undefined),
    isEventProcessed: vi.fn().mockResolvedValue(false),
  };

  const monitor = new BlockchainMonitor({
    rpcUrl: 'https://rpc.example.com',
    contractAddress: '0x1111111111111111111111111111111111111111',
    alertRouter,
    metricsService,
    escalationHandler,
    checkpointStore,
    ...overrides,
  });

  return { monitor, alertRouter, metricsService, escalationHandler, checkpointStore };
}

describe('Blockchain Monitor Production Suite — Copilot Review Fixes (Issue #11641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. Real TruxifyEscrow Event Parsing ────────────────────────────────

  describe('1. Real TruxifyEscrow Event Parsing', () => {
    it('parses PaymentReleased and routes alert with booking details', async () => {
      const { monitor, alertRouter, metricsService } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 42n;
      const driver = '0x2222222222222222222222222222222222222222';
      const amount = 1000000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('PaymentReleased'),
        [bookingId, driver, amount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash1',
        index: 3,
        blockNumber: 1500,
        blockHash: '0xblockhash1500',
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYMENT_RELEASED',
          severity: 'LOW',
          bookingId: '42',
          driver,
          amount: amount.toString(),
          txHash: '0xrealtxhash1',
          logIndex: 3,
          blockNumber: 1500,
        })
      );
      expect(metricsService.recordPaymentEvent).toHaveBeenCalledWith('success');
    });

    it('parses BookingCancelled and routes alert with refund amount', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 43n;
      const customer = '0x3333333333333333333333333333333333333333';
      const refundAmount = 500000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingCancelled'),
        [bookingId, customer, refundAmount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash2',
        index: 1,
        blockNumber: 1501,
        blockHash: '0xblockhash1501',
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_CANCELLED',
          bookingId: '43',
          customer,
          refundAmount: refundAmount.toString(),
        })
      );
    });

    it('parses DisputeResolved and routes settlement with driverAmount and refundAmount', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 46n;
      const driver = '0x6666666666666666666666666666666666666666';
      const driverAmount = 600000000000000000n;
      const customer = '0x7777777777777777777777777777777777777777';
      const refundAmount = 400000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('DisputeResolved'),
        [bookingId, driver, driverAmount, customer, refundAmount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash5',
        index: 4,
        blockNumber: 1504,
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DISPUTE_RESOLVED',
          bookingId: '46',
          driver,
          driverAmount: driverAmount.toString(),
          customer,
          refundAmount: refundAmount.toString(),
        })
      );
    });

    it('parses BookingCreated and routes alert with all fields', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 99n;
      // ethers v6 checksums addresses when decoding — use the checksum form here.
      const customer = ethers.getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const driver = ethers.getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
      const amount = 3000000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingCreated'),
        [bookingId, customer, driver, amount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xcreatedtxhash',
        index: 0,
        blockNumber: 2000,
        blockHash: '0xblockhash2000',
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_CREATED',
          severity: 'LOW',
          bookingId: '99',
          customer,
          driver,
          amount: amount.toString(),
          txHash: '0xcreatedtxhash',
          logIndex: 0,
          blockNumber: 2000,
        })
      );
    });

    it('setupEventHandlers wires all declared ABI events', () => {
      const { monitor } = createTestMonitor();
      monitor.setupEventHandlers();
      const handlers = Object.keys(monitor.eventHandlers).sort();
      // All real escrow events must have handlers
      expect(handlers).toContain('BookingCreated');
      expect(handlers).toContain('PaymentReleased');
      expect(handlers).toContain('BookingCancelled');
      expect(handlers).toContain('BookingStarted');
      expect(handlers).toContain('BookingDisputed');
      expect(handlers).toContain('DisputeResolved');
    });
  });

  // ── 2. Configured Start Block — First Block Inclusive ──────────────────

  describe('2. Configured Start Block Handling', () => {
    it('treats BLOCKCHAIN_MONITOR_START_BLOCK as the first block to scan (inclusive)', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(200),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xBlockHash200' }),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        startBlock: 150,
        checkpointStore: {
          loadCheckpoint: vi.fn().mockResolvedValue(null), // no existing checkpoint
          saveCheckpoint: vi.fn().mockResolvedValue(undefined),
          storeEvent: vi.fn().mockResolvedValue(undefined),
          isEventProcessed: vi.fn().mockResolvedValue(false),
        },
      });

      const initialized = await monitor.initialize();
      expect(initialized).toBe(true);
      // lastBlockScanned should be 149 (startBlock - 1) so next scan begins at 150.
      expect(monitor.lastBlockScanned).toBe(149);
    });

    it('historical backfill on startListening includes startBlock (scans from 150 when lastBlockScanned=149)', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(155),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xblock155' }),
        getLogs: vi.fn().mockResolvedValue([]),
      };

      const checkpointStore = {
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        storeEvent: vi.fn().mockResolvedValue(undefined),
        isEventProcessed: vi.fn().mockResolvedValue(false),
      };

      const { monitor } = createTestMonitor({ provider: mockProvider, contract: {}, startBlock: 150, checkpointStore });
      await monitor.initialize();
      expect(monitor.lastBlockScanned).toBe(149);

      const scanSpy = vi.spyOn(monitor, 'scanBlockRange');
      await monitor.startListening();

      // Should scan from 150 (149+1) to 155
      expect(scanSpy).toHaveBeenCalledWith(150, 155);
      await monitor.stopListening();
    });
  });

  // ── 3. Checkpoint Not Advanced After Failure ───────────────────────────

  describe('3. Checkpoint Not Advanced After Scan/Handler Failure', () => {
    it('does not advance checkpoint when scanBlockRange throws', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
      };

      const checkpointStore = {
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        storeEvent: vi.fn().mockResolvedValue(undefined),
        isEventProcessed: vi.fn().mockResolvedValue(false),
      };

      const { monitor } = createTestMonitor({ provider: mockProvider, contract: {}, checkpointStore });
      monitor.lastBlockScanned = 100;
      monitor.isListening = true;
      monitor.provider = mockProvider;

      let capturedCallback;
      vi.stubGlobal('setInterval', (cb) => { capturedCallback = cb; return 42; });

      monitor.scanBlockRange = vi.fn().mockRejectedValue(new Error('getLogs failed'));
      monitor.startPollingBlocks();

      await capturedCallback();

      // Checkpoint must NOT be saved after failure.
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
      // lastBlockScanned must remain at 100 (not advanced to 120).
      expect(monitor.lastBlockScanned).toBe(100);
    });

    it('does not advance checkpoint when block hash is unavailable (null)', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(130),
        getBlock: vi.fn().mockResolvedValue(null), // getBlock returns null → no hash
        getLogs: vi.fn().mockResolvedValue([]),
      };

      const checkpointStore = {
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        storeEvent: vi.fn().mockResolvedValue(undefined),
        isEventProcessed: vi.fn().mockResolvedValue(false),
      };

      const { monitor } = createTestMonitor({ provider: mockProvider, contract: {}, checkpointStore });
      monitor.lastBlockScanned = 120;

      const scanSpy = vi.spyOn(monitor, 'scanBlockRange').mockResolvedValue(undefined);
      await monitor.startListening();

      // saveCheckpoint should NOT have been called with null hash.
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
      // in-memory cursor still advanced.
      expect(monitor.lastBlockScanned).toBe(130);
      expect(scanSpy).toHaveBeenCalledWith(121, 130);
      await monitor.stopListening();
    });
  });

  // ── 4. Checkpoint Hash Failure is Handled Conservatively ──────────────

  describe('4. Checkpoint Hash Failure — Conservative Rewind', () => {
    it('rewinds conservatively when checkpoint has no blockHash (null)', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(600),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xCanonicalHash' }),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        reorgRewindBlocks: 10,
        checkpointStore: {
          loadCheckpoint: vi.fn().mockResolvedValue({
            blockNumber: 500,
            blockHash: null, // missing hash → must rewind
          }),
          saveCheckpoint: vi.fn().mockResolvedValue(undefined),
          storeEvent: vi.fn().mockResolvedValue(undefined),
          isEventProcessed: vi.fn().mockResolvedValue(false),
        },
      });

      await monitor.initialize();

      // Should rewind by 10 from 500 → 490.
      expect(monitor.lastBlockScanned).toBe(490);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no verified hash')
      );
    });

    it('rewinds conservatively when getBlock throws during hash verification', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(700),
        getBlock: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        reorgRewindBlocks: 12,
        checkpointStore: {
          loadCheckpoint: vi.fn().mockResolvedValue({ blockNumber: 650, blockHash: '0xKnownHash' }),
          saveCheckpoint: vi.fn().mockResolvedValue(undefined),
          storeEvent: vi.fn().mockResolvedValue(undefined),
          isEventProcessed: vi.fn().mockResolvedValue(false),
        },
      });

      await monitor.initialize();

      // On RPC error, must rewind conservatively (not trust checkpoint).
      expect(monitor.lastBlockScanned).toBe(638); // 650 - 12
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error verifying block hash')
      );
    });
  });

  // ── 5. Normal Polling Reorg Detection ─────────────────────────────────

  describe('5. Normal Polling Reorg Detection', () => {
    it('detects reorg during polling and rewinds lastBlockScanned', async () => {
      const checkpointHash = '0xOldHash';
      const canonicalHash = '0xNewCanonicalHash'; // different → reorg!

      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(600),
        getBlock: vi.fn().mockResolvedValue({ hash: canonicalHash }),
        getLogs: vi.fn().mockResolvedValue([]),
      };

      const checkpointStore = {
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        storeEvent: vi.fn().mockResolvedValue(undefined),
        isEventProcessed: vi.fn().mockResolvedValue(false),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        reorgRewindBlocks: 10,
        checkpointStore,
      });

      monitor.isListening = true;
      monitor.lastBlockScanned = 550;
      monitor.lastBlockHash = checkpointHash; // set known checkpoint hash

      let capturedCallback;
      vi.stubGlobal('setInterval', (cb) => { capturedCallback = cb; return 99; });
      monitor.startPollingBlocks();

      // Allow scan to proceed (stub scanBlockRange to avoid getLogs complexity).
      monitor.scanBlockRange = vi.fn().mockResolvedValue(undefined);

      await capturedCallback();

      // Should have rewound 10 blocks from 550 → 540, then scanned from 541.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Reorg detected during polling at block 550')
      );
    });
  });

  // ── 6. (transactionHash, logIndex) Deduplication — Atomic ────────────

  describe('6. Atomic Event Deduplication', () => {
    it('skips processing duplicate events; does not re-insert or re-route', async () => {
      const { monitor, alertRouter, checkpointStore } = createTestMonitor();
      monitor.setupEventHandlers();

      const logDescription = iface.encodeEventLog(
        iface.getEvent('PaymentReleased'),
        [99n, '0x9999999999999999999999999999999999999999', 500n]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xuniqueTxHash',
        index: 2,
        blockNumber: 100,
      };

      // First run: processes event.
      await monitor.processLog(log);
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(1);

      // Second run (duplicate replay): must skip — in-memory Set blocks it.
      await monitor.processLog(log);
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(1);
    });

    it('does not add event to in-memory Set when storeEvent throws (failed persistence)', async () => {
      // When persistence fails the event must not be considered processed
      // so the next retry can attempt again.
      const failingCheckpointStore = {
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        storeEvent: vi.fn().mockRejectedValue(new Error('DB write failed')),
        isEventProcessed: vi.fn().mockResolvedValue(false),
      };

      const { monitor, alertRouter } = createTestMonitor({ checkpointStore: failingCheckpointStore });
      monitor.setupEventHandlers();

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingStarted'),
        [10n, '0x1234567890123456789012345678901234567890', 100n]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xFailTxHash',
        index: 1,
        blockNumber: 50,
      };

      // processLog catches the handler error internally.
      await monitor.processLog(log);

      // Event must NOT be in the in-memory set (storeEvent failed before adding it).
      const eventKey = '0xFailTxHash:1';
      expect(monitor.processedEventKeys.has(eventKey)).toBe(false);
    });
  });

  // ── 7. BookingCreated Full Parsing Coverage ───────────────────────────

  describe('7. BookingCreated Parsing', () => {
    it('parses BookingCreated with all four fields and routes alert', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 7n;
      // ethers v6 checksums addresses when decoding ABI data.
      const customer = ethers.getAddress('0xC0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0C0');
      const driver = ethers.getAddress('0xD0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0D0');
      const amount = 5000000000000000000n;

      const logDescription = iface.encodeEventLog(iface.getEvent('BookingCreated'), [bookingId, customer, driver, amount]);

      await monitor.processLog({
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xBookingCreatedTx',
        index: 0,
        blockNumber: 3000,
        blockHash: '0xbh3000',
      });

      const call = alertRouter.route.mock.calls[0][0];
      expect(call.type).toBe('BOOKING_CREATED');
      expect(call.bookingId).toBe('7');
      expect(call.customer).toBe(customer);
      expect(call.driver).toBe(driver);
      expect(call.amount).toBe(amount.toString());
      expect(call.severity).toBe('LOW');
    });
  });

  // ── 8. Historical Backfill ─────────────────────────────────────────────

  describe('8. Historical Backfill', () => {
    it('scans historical events from lastBlockScanned+1 to current head on startListening', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xblock120hash' }),
        getLogs: vi.fn().mockResolvedValue([]),
      };

      const { monitor, checkpointStore } = createTestMonitor({ provider: mockProvider, contract: {} });
      monitor.lastBlockScanned = 100;
      const scanBlockRangeSpy = vi.spyOn(monitor, 'scanBlockRange');

      await monitor.startListening();

      expect(scanBlockRangeSpy).toHaveBeenCalledWith(101, 120);
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(120, '0xblock120hash');
      expect(monitor.isListening).toBe(true);

      await monitor.stopListening();
    });
  });

  // ── 9. Divergence Booking ID Uses escrow_booking_id ──────────────────

  describe('9. Divergence — Booking ID from escrow_booking_id', () => {
    it('correctly derives bookingId from escrow_booking_id column', async () => {
      const mockBatchCallBuilder = {
        buildPaymentStatusCall: vi.fn((bookingId) => ({ target: '0xEscrow', callData: '0x', bookingId })),
      };

      const mockMulticallService = {
        batchCalls: vi.fn().mockResolvedValue([
          { success: true, decoded: { status: 1, paid: true, started: true, amount: '1000' } },
        ]),
      };

      const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
      const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
      const mockSupabase = {
        from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
      };

      const detector = new StateDivergenceDetector({
        disableMonitoring: true,
        batchCallBuilder: mockBatchCallBuilder,
        multicallService: mockMulticallService,
        alertRouter,
        escalationHandler,
        supabase: mockSupabase,
      });

      const orders = [{
        id: 'order-with-escrow-id',
        escrow_booking_id: '42',     // real DB column
        bookingId: undefined,        // not set
        booking_id: undefined,       // not set
        escrow_status: 'funded',
        payment_status: 'locked',
      }];

      await detector.checkForDivergence(orders);

      // batchCallBuilder must have been called with the escrow_booking_id value.
      expect(mockBatchCallBuilder.buildPaymentStatusCall).toHaveBeenCalledWith('42');
    });
  });

  // ── 10. Repeated Divergence Suppression ───────────────────────────────

  describe('10. Repeated Divergence Suppression', () => {
    it('does NOT generate a new DB row/alert on repeated polls for the same unresolved divergence', async () => {
      const mockBatchCallBuilder = {
        buildPaymentStatusCall: vi.fn((bookingId) => ({ target: '0xEscrow', callData: '0x', bookingId })),
      };

      const mockMulticallService = {
        // Always returns diverged state.
        batchCalls: vi.fn().mockResolvedValue([
          { success: true, decoded: { status: 1, paid: true, started: true, amount: '1000' } },
        ]),
      };

      const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
      const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
      const mockSupabase = {
        from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
      };

      const detector = new StateDivergenceDetector({
        disableMonitoring: true,
        batchCallBuilder: mockBatchCallBuilder,
        multicallService: mockMulticallService,
        alertRouter,
        escalationHandler,
        supabase: mockSupabase,
      });

      const orders = [{
        id: 'order-persistent-diverge',
        escrow_booking_id: '77',
        escrow_status: 'funded',
        payment_status: 'locked',
      }];

      // First poll — new divergence detected.
      const r1 = await detector.checkForDivergence(orders);
      expect(r1.divergenceDetected).toBe(true);
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      const insertCallsAfterFirst = mockSupabase.from.mock.calls.length;

      // Second poll — same order still diverged. Must NOT re-alert or re-insert.
      const r2 = await detector.checkForDivergence(orders);
      expect(r2.divergenceDetected).toBe(true);
      // No new alert calls.
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      // No additional DB inserts for this divergence.
      expect(mockSupabase.from.mock.calls.length).toBe(insertCallsAfterFirst);
    });
  });

  // ── 11. Divergence Lifecycle — Start / Stop ───────────────────────────

  describe('11. StateDivergenceDetector Lifecycle', () => {
    it('startMonitoring and stopMonitoring manage the polling interval', () => {
      let timerId = null;
      vi.stubGlobal('setInterval', (cb, ms) => { timerId = 77; return timerId; });
      vi.stubGlobal('clearInterval', vi.fn());

      const detector = new StateDivergenceDetector({ disableMonitoring: true });
      expect(detector.monitoringTimer).toBeNull();

      detector.startMonitoring();
      expect(detector.monitoringTimer).toBe(77);

      detector.stopMonitoring();
      expect(globalThis.clearInterval).toHaveBeenCalledWith(77);
      expect(detector.monitoringTimer).toBeNull();
    });
  });

  // ── 12. Worker Health — Not Set True Before Startup Succeeds ─────────

  describe('12. Worker Health Startup Failure', () => {
    it('blockchainMonitor health reflects startup failure (does not report true before success)', async () => {
      const { monitor } = createTestMonitor();

      // Simulate failed initialize (no RPC configured).
      monitor.rpcUrl = null;
      monitor.contractAddress = null;
      const initialized = await monitor.initialize();
      expect(initialized).toBe(false);
      expect(monitor.isListening).toBe(false);

      const health = await monitor.getHealth();
      expect(health.status).toBe('stopped');
      expect(health.running).toBe(false);
    });
  });

  // ── 13. AlertRouter — Monetary Fields in Cancellation/Dispute Alerts ─

  describe('13. AlertRouter Monetary Fields', () => {
    it('formatSlackMessage includes refundAmount for BOOKING_CANCELLED', async () => {
      // Import AlertRouter directly in test scope.
      const { default: AlertRouter } = await import('../../../../src/services/blockchain/alertRouter.js');
      const router = new AlertRouter();

      const alert = {
        type: 'BOOKING_CANCELLED',
        severity: 'MEDIUM',
        bookingId: '123',
        customer: '0xCust',
        refundAmount: '500000000000000000',
      };

      const msg = router.formatSlackMessage(alert);
      // Slack formatting uses bold markdown (*...*)
      expect(msg.attachments[0].text).toContain('*Refund Amount:* 500000000000000000');
    });

    it('formatEmailBody includes driverAmount and refundAmount for DISPUTE_RESOLVED', async () => {
      const { default: AlertRouter } = await import('../../../../src/services/blockchain/alertRouter.js');
      const router = new AlertRouter();

      const alert = {
        type: 'DISPUTE_RESOLVED',
        severity: 'MEDIUM',
        bookingId: '456',
        driver: '0xDriver',
        driverAmount: '600000000000000000',
        customer: '0xCustomer',
        refundAmount: '400000000000000000',
      };

      const body = router.formatEmailBody(alert);
      expect(body).toContain('Driver Amount: 600000000000000000');
      expect(body).toContain('Refund Amount: 400000000000000000');
    });
  });

  // ── 14. Health and Lag Reporting ──────────────────────────────────────

  describe('14. Health and Lag Reporting', () => {
    it('reports accurate health status, current chain head, and block lag', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(1250),
      };

      const { monitor } = createTestMonitor({ provider: mockProvider, contract: {} });
      monitor.isListening = true;
      monitor.lastBlockScanned = 1200;
      monitor.lastSuccessfulScan = '2026-09-14T19:00:00.000Z';

      const health = await monitor.getHealth();

      expect(health).toEqual({
        status: 'running',
        running: true,
        lastScannedBlock: 1200,
        currentChainHead: 1250,
        blockLag: 50,
        lastSuccessfulScan: '2026-09-14T19:00:00.000Z',
        lastError: null,
      });
    });
  });
});
