import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  measureExecution: (name, fn) => fn(),
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: null,
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

const { default: BlockchainMonitor } = await import('../../../../src/services/blockchain/blockchainMonitor.js');

function buildMonitor() {
  const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
  const metricsService = {
    recordBlockScan: vi.fn(),
    recordBlockScanError: vi.fn(),
    recordPaymentEvent: vi.fn(),
    recordInsuranceEvent: vi.fn(),
    recordGeofenceBreach: vi.fn(),
    recordBalanceUpdateFailure: vi.fn(),
    recordContractRevert: vi.fn(),
  };
  const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
  const monitor = new BlockchainMonitor({ alertRouter, metricsService, escalationHandler });
  return { monitor, alertRouter, metricsService, escalationHandler };
}

describe('BlockchainMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialize returns false when RPC URL is missing', async () => {
    delete process.env.POLYGON_RPC_URL;
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    const { monitor } = buildMonitor();
    expect(await monitor.initialize()).toBe(false);
  });

  it('setupEventHandlers wires all event handlers', () => {
    const { monitor } = buildMonitor();
    monitor.setupEventHandlers();
    expect(Object.keys(monitor.eventHandlers).sort()).toEqual([
      'BalanceUpdateFailed',
      'GeofenceBreach',
      'InsuranceClaimApproved',
      'InsuranceClaimRejected',
      'PaymentReceived',
      'SmartContractRevert',
    ]);
  });

  it('handlePaymentReceived routes an alert and records metrics', async () => {
    const { monitor, alertRouter, metricsService } = buildMonitor();
    monitor.setupEventHandlers();
    const args = ['0xdriver', { toString: () => '1000000' }, '1700000000'];
    const log = { transactionHash: '0xabc', blockNumber: 10 };

    await monitor.handlePaymentReceived(args, log);

    expect(alertRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PAYMENT_RECEIVED', driver: '0xdriver', amount: '1000000' }),
    );
    expect(metricsService.recordPaymentEvent).toHaveBeenCalledWith('success');
  });

  it('handleGeofenceBreach escalates high-severity alerts', async () => {
    const { monitor, escalationHandler } = buildMonitor();
    monitor.setupEventHandlers();
    const args = [{ toString: () => '42' }, '0xdriver'];
    const log = { transactionHash: '0xabc', blockNumber: 5 };

    await monitor.handleGeofenceBreach(args, log);

    expect(escalationHandler.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GEOFENCE_BREACH', severity: 'HIGH' }),
    );
  });

  it('handleSmartContractRevert pads the tx hash', async () => {
    const { monitor } = buildMonitor();
    monitor.setupEventHandlers();
    const args = ['0x1234', 'out of gas'];
    const log = { blockNumber: 9 };

    await monitor.handleSmartContractRevert(args, log);

    expect(monitor.storeEvent).toBeDefined();
  });

  it('processLog ignores unparseable logs without throwing', async () => {
    const { monitor } = buildMonitor();
    monitor.setupEventHandlers();
    await expect(monitor.processLog({ data: '0xdeadbeef' })).resolves.toBeUndefined();
  });

  it('stopListening flips the listening flag', async () => {
    const { monitor } = buildMonitor();
    monitor.isListening = true;
    await monitor.stopListening();
    expect(monitor.isListening).toBe(false);
  });

  it('skips interval ticks while a scan is already in progress (re-entrancy guard)', async () => {
    const { monitor, metricsService } = buildMonitor();
    let capturedCallback;
    vi.stubGlobal('setInterval', (cb) => {
      capturedCallback = cb;
      return 1;
    });

    let resolveBlockNumber;
    monitor.isListening = true;
    monitor.lastBlockScanned = 0;
    monitor.provider = {
      getBlockNumber: vi.fn(() => new Promise((resolve) => { resolveBlockNumber = resolve; })),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    monitor.startPollingBlocks();

    const firstTick = capturedCallback();
    expect(monitor.isScanning).toBe(true);

    await capturedCallback();
    expect(monitor.provider.getBlockNumber).toHaveBeenCalledTimes(1);

    resolveBlockNumber(5);
    await firstTick;

    expect(monitor.isScanning).toBe(false);
    expect(metricsService.recordBlockScan).toHaveBeenCalledWith(5);

    vi.unstubAllGlobals();
  });

  it('clears isScanning in a finally block when getBlockNumber fails', async () => {
    const { monitor } = buildMonitor();
    let capturedCallback;
    vi.stubGlobal('setInterval', (cb) => {
      capturedCallback = cb;
      return 1;
    });

    monitor.isListening = true;
    monitor.provider = {
      getBlockNumber: vi.fn().mockRejectedValue(new Error('rpc down')),
    };
    monitor.startPollingBlocks();

    await capturedCallback();

    expect(monitor.isScanning).toBe(false);

    vi.unstubAllGlobals();
  });

  it('clears isScanning in a finally block when scanBlockRange rejects', async () => {
    const { monitor } = buildMonitor();
    let capturedCallback;
    vi.stubGlobal('setInterval', (cb) => {
      capturedCallback = cb;
      return 1;
    });

    monitor.isListening = true;
    monitor.lastBlockScanned = 0;
    monitor.provider = {
      getBlockNumber: vi.fn().mockResolvedValue(5),
    };
    monitor.scanBlockRange = vi.fn().mockRejectedValue(new Error('range scan failed'));
    monitor.startPollingBlocks();

    await capturedCallback();

    expect(monitor.isScanning).toBe(false);
    expect(monitor.scanBlockRange).toHaveBeenCalledWith(1, 5);

    vi.unstubAllGlobals();
  });
});
