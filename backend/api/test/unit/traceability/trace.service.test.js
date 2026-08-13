import { describe, it, expect, vi, beforeEach } from 'vitest';

const { from, loggerMock, contractMock } = vi.hoisted(() => ({
  from: vi.fn(() => ({ insert: vi.fn(() => ({ error: null })) })),
  loggerMock: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  contractMock: {
    createShipment: vi.fn(),
    interface: { parseLog: vi.fn() },
    getTotalShipments: vi.fn(),
  },
}));

vi.mock('ethers', () => ({
  JsonRpcProvider: class {},
  Wallet: class {},
  Contract: class {
    constructor() {
      return contractMock;
    }
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: loggerMock }));
vi.mock('../../src/config/db.js', () => ({ supabase: { from } }));

const { TraceabilityService } = await import('../../../traceability/trace.service.js');

process.env.POLYGON_RPC_URL = 'http://localhost:8545';
process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
process.env.SUPPLY_CHAIN_ADDRESS = '0x' + '2'.repeat(40);

const makeReceipt = (logs) => ({
  hash: '0xtxhash',
  logs,
});

const buildService = () => new TraceabilityService();

describe('TraceabilityService.createShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives shipmentId from the ShipmentCreated event (no counter fallback)', async () => {
    const service = buildService();

    contractMock.createShipment.mockResolvedValue({
      wait: async () =>
        makeReceipt([
          { topic: 'x' },
        ]),
    });
    contractMock.interface.parseLog.mockReturnValue({
      name: 'ShipmentCreated',
      args: { shipmentId: 7n },
    });

    const result = await service.createShipment(1, '0xreceiver', 'Loc');

    expect(result.success).toBe(true);
    expect(result.shipmentId).toBe('7');
    expect(contractMock.getTotalShipments).not.toHaveBeenCalled();
  });

  it('throws when the ShipmentCreated event is missing instead of guessing an id', async () => {
    const service = buildService();

    contractMock.createShipment.mockResolvedValue({
      wait: async () => makeReceipt([{ topic: 'x' }]),
    });
    contractMock.interface.parseLog.mockReturnValue({
      name: 'SomeOtherEvent',
      args: {},
    });

    await expect(service.createShipment(1, '0xreceiver', 'Loc')).rejects.toThrow(
      /ShipmentCreated event not found/
    );
    expect(contractMock.getTotalShipments).not.toHaveBeenCalled();
  });

  it('produces unique shipment ids and never relies on the total-shipments counter', async () => {
    const service = buildService();

    let call = 0;
    contractMock.createShipment.mockImplementation(async () => ({
      wait: async () =>
        makeReceipt([{ topic: 'x' }]),
    }));
    contractMock.interface.parseLog.mockImplementation(() => ({
      name: 'ShipmentCreated',
      args: { shipmentId: BigInt(++call) },
    }));

    const a = await service.createShipment(1, '0xr', 'Loc');
    const b = await service.createShipment(1, '0xr', 'Loc');

    expect(a.shipmentId).not.toBe(b.shipmentId);
    expect(contractMock.getTotalShipments).not.toHaveBeenCalled();
  });
});
