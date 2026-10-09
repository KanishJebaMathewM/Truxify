/**
 * Regression tests for BlockchainMonitor's failure-handling contract.
 *
 * The monitor documents that its checkpoint "is only advanced if the full scan and
 * all handlers succeed". These tests pin the behaviour that makes that true:
 *
 *   1. supabase-js RETURNS { error } instead of throwing, so storeEvent must check it.
 *   2. A failure while handling a decoded event must propagate out of processLog /
 *      scanBlockRange so the checkpoint is not advanced past it.
 *   3. A poison event is dead-lettered after maxEventRetries so it cannot wedge the monitor.
 *   4. Handlers commit the de-duplication marker (storeEvent) LAST, otherwise a retry
 *      after a failed side effect (e.g. escalation) would be skipped as a duplicate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  supabaseAdmin: { from: vi.fn() },
  supabase: null,
  redisClient: null,
}));

vi.mock('../../../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));
vi.mock('../../../../src/config/db.js', () => mockDb);
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import BlockchainMonitor from '../../../../src/services/blockchain/blockchainMonitor.js';

/**
 * Logs carry a pre-decoded payload so the tests exercise the monitor's control flow
 * without depending on ABI encoding.
 */
function parsedLog(name, args, { tx, index = 0, block = 105 }) {
  return {
    __parsed: { name, args },
    transactionHash: tx,
    index,
    blockNumber: block,
    blockHash: `0xbh${block}`,
  };
}
const disputeLog = (tx = '0xDispute', block = 105) => parsedLog('BookingDisputed', [42n, '0xRaiser'], { tx, block });
const startedLog = (tx = '0xStarted', block = 106) => parsedLog('BookingStarted', [7n, '0xDriver', 5n], { tx, block });

function createMonitor(overrides = {}) {
  const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
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
    escalationHandler,
    checkpointStore,
    ...overrides,
  });
  monitor.setupEventHandlers();
  return { monitor, alertRouter, escalationHandler, checkpointStore };
}

describe('BlockchainMonitor failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ethers.Interface.prototype, 'parseLog').mockImplementation((log) => {
      if (!log || !log.__parsed) throw new TypeError('cannot decode log');
      return log.__parsed;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('storeEvent honours the supabase-js { error } contract', () => {
    const alert = { type: 'BOOKING_DISPUTED', severity: 'HIGH', txHash: '0xAbc', logIndex: 3 };

    it('throws and does not mark the event processed when the insert returns an error', async () => {
      mockDb.supabaseAdmin.from.mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: { message: 'row-level security violation' } }),
      });
      const { monitor } = createMonitor({ checkpointStore: null });

      await expect(monitor.storeEvent(alert)).rejects.toThrow('row-level security violation');
      expect(monitor.processedEventKeys.has('0xAbc:3')).toBe(false);
    });

    it('marks the event processed only after a successful insert', async () => {
      mockDb.supabaseAdmin.from.mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const { monitor } = createMonitor({ checkpointStore: null });

      await monitor.storeEvent(alert);
      expect(monitor.processedEventKeys.has('0xAbc:3')).toBe(true);
    });
  });

  describe('processLog error contract', () => {
    it('re-throws a persistence failure and does not mark the event processed', async () => {
      const { monitor, checkpointStore } = createMonitor();
      checkpointStore.storeEvent.mockRejectedValue(new Error('DB write failed'));

      await expect(monitor.processLog(disputeLog())).rejects.toThrow('DB write failed');
      expect(monitor.processedEventKeys.has('0xDispute:0')).toBe(false);
      expect(monitor.eventFailureCounts.get('0xDispute:0')).toBe(1);
    });

    it('retries the event successfully once the transient failure clears', async () => {
      const { monitor, checkpointStore } = createMonitor();
      checkpointStore.storeEvent
        .mockRejectedValueOnce(new Error('transient outage'))
        .mockResolvedValueOnce(undefined);

      await expect(monitor.processLog(disputeLog())).rejects.toThrow('transient outage');
      await expect(monitor.processLog(disputeLog())).resolves.toBeUndefined();

      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(2);
      expect(monitor.processedEventKeys.has('0xDispute:0')).toBe(true);
      expect(monitor.eventFailureCounts.has('0xDispute:0')).toBe(false);
    });

    it('still skips logs that cannot be decoded without throwing', async () => {
      const { monitor, checkpointStore } = createMonitor();

      await expect(monitor.processLog({ data: '0xdeadbeef' })).resolves.toBeUndefined();
      expect(checkpointStore.storeEvent).not.toHaveBeenCalled();
    });

    it('dead-letters a poison event after maxEventRetries and stops invoking its handler', async () => {
      const { monitor, checkpointStore } = createMonitor({ maxEventRetries: 3 });
      checkpointStore.storeEvent.mockRejectedValue(new Error('always fails'));

      await expect(monitor.processLog(disputeLog())).rejects.toThrow('always fails'); // attempt 1
      await expect(monitor.processLog(disputeLog())).rejects.toThrow('always fails'); // attempt 2
      await expect(monitor.processLog(disputeLog())).resolves.toBeUndefined(); // attempt 3 -> dead-lettered
      await expect(monitor.processLog(disputeLog())).resolves.toBeUndefined(); // skipped, handler not run

      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('scan / checkpoint behaviour', () => {
    it('does not advance the checkpoint while an event handler is failing, then advances after it recovers', async () => {
      const provider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xblock120' }),
        getLogs: vi.fn().mockResolvedValue([disputeLog('0xPoll', 110)]),
      };
      const { monitor, checkpointStore } = createMonitor({ provider, contract: {} });
      monitor.lastBlockScanned = 100;
      monitor.isListening = true;

      let tick;
      vi.stubGlobal('setInterval', (cb) => { tick = cb; return 42; });
      monitor.startPollingBlocks();

      checkpointStore.storeEvent.mockRejectedValueOnce(new Error('DB down'));
      await tick();
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
      expect(monitor.lastBlockScanned).toBe(100);

      await tick(); // DB is back: the same range is retried
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(120, '0xblock120');
      expect(monitor.lastBlockScanned).toBe(120);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(2);
    });

    it('a dead-lettered poison event does not block later events in the same range', async () => {
      const provider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
        getLogs: vi.fn().mockResolvedValue([disputeLog('0xPoison', 103), startedLog('0xGood', 108)]),
      };
      const { monitor, checkpointStore } = createMonitor({ provider, contract: {}, maxEventRetries: 2 });
      checkpointStore.storeEvent.mockImplementation(async (alert) => {
        if (alert.type === 'BOOKING_DISPUTED') throw new Error('poison');
      });

      await expect(monitor.scanBlockRange(101, 120)).rejects.toThrow('poison'); // poison attempt 1
      await expect(monitor.scanBlockRange(101, 120)).resolves.toBeUndefined(); // dead-lettered, good event handled

      const storedTypes = checkpointStore.storeEvent.mock.calls.map(([alert]) => alert.type);
      expect(storedTypes).toContain('BOOKING_STARTED');
    });

    it('startListening still starts polling when the historical backfill fails', async () => {
      const provider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xblock120' }),
        getLogs: vi.fn().mockRejectedValue(new Error('rpc unavailable')),
      };
      const { monitor, checkpointStore } = createMonitor({ provider, contract: {} });
      monitor.lastBlockScanned = 100;
      vi.stubGlobal('setInterval', () => 42);

      await monitor.startListening();

      expect(monitor.isListening).toBe(true); // polling will retry the range
      expect(monitor.lastBlockScanned).toBe(100); // cursor untouched
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
      expect(monitor.lastError).toBe('rpc unavailable');
      await monitor.stopListening();
    });
  });

  describe('handlers commit the de-duplication marker last', () => {
    it('routes and escalates BEFORE persisting the event', async () => {
      const order = [];
      const { monitor, alertRouter, escalationHandler, checkpointStore } = createMonitor();
      alertRouter.route.mockImplementation(async () => { order.push('route'); });
      escalationHandler.escalate.mockImplementation(async () => { order.push('escalate'); });
      checkpointStore.storeEvent.mockImplementation(async () => { order.push('store'); });

      await monitor.processLog(disputeLog());

      expect(order).toEqual(['route', 'escalate', 'store']);
    });

    it('retries a dispute whose escalation failed instead of skipping it as a duplicate', async () => {
      const { monitor, escalationHandler, checkpointStore } = createMonitor();
      escalationHandler.escalate
        .mockRejectedValueOnce(new Error('storeEscalation failed'))
        .mockResolvedValueOnce(undefined);

      await expect(monitor.processLog(disputeLog())).rejects.toThrow('storeEscalation failed');
      expect(checkpointStore.storeEvent).not.toHaveBeenCalled(); // not committed yet

      await expect(monitor.processLog(disputeLog())).resolves.toBeUndefined();
      expect(escalationHandler.escalate).toHaveBeenCalledTimes(2);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(1);
    });
  });
});
