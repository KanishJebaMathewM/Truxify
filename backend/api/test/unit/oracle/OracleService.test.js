import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../src/services/order/deliveryVerificationService.js', () => ({
  DeliveryVerificationService: vi.fn().mockImplementation(() => ({
    assertDriverAtDropoff: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
}));

// Build a configurable supabase chain mock.
function createChain({ otpRecord, orderRecord, error = null } = {}) {
  const chain = {
    otpRecord,
    orderRecord,
    error,
    from: vi.fn(),
    select: vi.fn(function () {
      return this;
    }),
    eq: vi.fn(function () {
      return this;
    }),
    order: vi.fn(function () {
      return this;
    }),
    limit: vi.fn(function () {
      return this;
    }),
    maybeSingle: vi.fn(function () {
      const data = this.lastTable === 'delivery_otps'
        ? this.otpRecord
        : this.orderRecord;
      return Promise.resolve({ data: data ?? null, error: this.error });
    }),
  };
  chain.from = vi.fn((table) => {
    chain.lastTable = table;
    return chain;
  });
  return chain;
}

const { default: OracleService, ORACLE_PROVIDER_COUNT, ORACLE_THRESHOLD } = await import('../../../src/oracle/OracleService.js');
const { hashOtp } = await import('../../../src/lib/otpHashing.js');

describe('OracleService', () => {
  let service;
  let chain;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    chain = createChain();
    service = new OracleService({ supabase: { from: chain.from }, orderRepository: null });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Constructor Defaults & Dependency Injection', () => {
    it('sets default properties when no dependencies are provided', () => {
      const defaultService = new OracleService();
      expect(defaultService.orderRepository).toBeNull();
      expect(defaultService.supabase).toBeDefined();
      expect(defaultService.chainlinkRpcUrl).toBeNull();
      expect(defaultService.defaultGasPriceGwei).toBe(30);
    });

    it('accepts custom injected dependencies', () => {
      const customRepo = { findById: vi.fn() };
      const customDb = { from: vi.fn() };
      const customService = new OracleService({
        orderRepository: customRepo,
        supabase: customDb,
        chainlinkRpcUrl: 'https://polygon-mainnet.g.alchemy.com',
        defaultGasPriceGwei: 45,
      });

      expect(customService.orderRepository).toBe(customRepo);
      expect(customService.supabase).toBe(customDb);
      expect(customService.chainlinkRpcUrl).toBe('https://polygon-mainnet.g.alchemy.com');
      expect(customService.defaultGasPriceGwei).toBe(45);
    });

    it('reads configuration from environment variables if not passed in deps', () => {
      process.env.CHAINLINK_RPC_URL = 'https://rpc.example.com';
      process.env.DEFAULT_GAS_PRICE_GWEI = '50';

      const envService = new OracleService();
      expect(envService.chainlinkRpcUrl).toBe('https://rpc.example.com');
      expect(envService.defaultGasPriceGwei).toBe(50);
    });
  });

  describe('getStatus & Environment Variable Overrides', () => {
    it('returns default status when optional environment flags are absent', () => {
      delete process.env.CHAINLINK_ENABLED;
      delete process.env.BACKUP_ORACLE_ENABLED;
      delete process.env.ORACLE_CONSENSUS_THRESHOLD;

      const status = service.getStatus();
      expect(status.providers).toBe(ORACLE_PROVIDER_COUNT); // 3
      expect(status.threshold).toBe(ORACLE_THRESHOLD); // 2
      expect(status.chainlinkEnabled).toBe(false);
      expect(status.backupOracleEnabled).toBe(false);
      expect(status.timestamp).toBeDefined();
    });

    it('applies CHAINLINK_ENABLED and BACKUP_ORACLE_ENABLED overrides', () => {
      process.env.CHAINLINK_ENABLED = 'true';
      process.env.BACKUP_ORACLE_ENABLED = 'true';

      const status = service.getStatus();
      expect(status.providers).toBe(5); // 3 core + 1 chainlink + 1 backup
      expect(status.chainlinkEnabled).toBe(true);
      expect(status.backupOracleEnabled).toBe(true);
    });

    it('applies custom ORACLE_CONSENSUS_THRESHOLD override', () => {
      process.env.ORACLE_CONSENSUS_THRESHOLD = '4';
      const status = service.getStatus();
      expect(status.threshold).toBe(4);
    });

    it('falls back to default threshold for non-integer or negative env threshold', () => {
      process.env.ORACLE_CONSENSUS_THRESHOLD = 'invalid';
      expect(service.getStatus().threshold).toBe(ORACLE_THRESHOLD);

      process.env.ORACLE_CONSENSUS_THRESHOLD = '-2';
      expect(service.getStatus().threshold).toBe(ORACLE_THRESHOLD);

      process.env.ORACLE_CONSENSUS_THRESHOLD = '0';
      expect(service.getStatus().threshold).toBe(ORACLE_THRESHOLD);
    });
  });

  describe('Price Feed Retrieval & Fallback Behavior (getPriceFeed)', () => {
    it('returns baseline price for standard pairs', async () => {
      const maticFeed = await service.getPriceFeed('MATIC/USD');
      expect(maticFeed.pair).toBe('MATIC/USD');
      expect(maticFeed.price).toBe(0.75);
      expect(maticFeed.fallback).toBe(true);
      expect(maticFeed.source).toBe('fallback');

      const ethFeed = await service.getPriceFeed('ETH/USD');
      expect(ethFeed.price).toBe(3000.0);

      const fuelFeed = await service.getPriceFeed('FUEL/USD');
      expect(fuelFeed.price).toBe(3.90);
    });

    it('normalizes pair string case and whitespace', async () => {
      const feed = await service.getPriceFeed('  matic/usd  ');
      expect(feed.pair).toBe('MATIC/USD');
      expect(feed.price).toBe(0.75);
    });

    it('uses environment variable price override when configured', async () => {
      process.env.ORACLE_PRICE_MATIC_USD = '0.92';
      const feed = await service.getPriceFeed('MATIC/USD');
      expect(feed.price).toBe(0.92);
      expect(feed.source).toBe('env_override');
      expect(feed.fallback).toBe(false);
    });

    it('fetches live price when Chainlink is enabled and RPC/fetch function is provided', async () => {
      process.env.CHAINLINK_ENABLED = 'true';
      const mockFetchPrice = vi.fn().mockResolvedValue(0.88);

      const feed = await service.getPriceFeed('MATIC/USD', {
        rpcUrl: 'https://rpc.example.com',
        fetchPriceFn: mockFetchPrice,
      });

      expect(mockFetchPrice).toHaveBeenCalledWith('MATIC/USD');
      expect(feed.price).toBe(0.88);
      expect(feed.source).toBe('chainlink');
      expect(feed.fallback).toBe(false);
    });

    it('handles network failure during price fetch and falls back gracefully', async () => {
      process.env.CHAINLINK_ENABLED = 'true';
      const mockFetchPrice = vi.fn().mockRejectedValue(new Error('Network timeout contacting Chainlink RPC'));

      const feed = await service.getPriceFeed('MATIC/USD', {
        rpcUrl: 'https://rpc.example.com',
        fetchPriceFn: mockFetchPrice,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ pair: 'MATIC/USD' }),
        expect.stringContaining('Failed to fetch live price feed')
      );
      expect(feed.price).toBe(0.75); // baseline fallback
      expect(feed.fallback).toBe(true);
      expect(feed.source).toBe('fallback');
    });

    it('uses custom fallbackPrice when provided in options', async () => {
      const feed = await service.getPriceFeed('CUSTOM/TOKEN', { fallbackPrice: 42.5 });
      expect(feed.pair).toBe('CUSTOM/TOKEN');
      expect(feed.price).toBe(42.5);
      expect(feed.fallback).toBe(true);
    });

    it('defaults unknown pair price to 1.0 if no baseline exists', async () => {
      const feed = await service.getPriceFeed('UNKNOWN/PAIR');
      expect(feed.price).toBe(1.0);
      expect(feed.fallback).toBe(true);
    });
  });

  describe('confirmDelivery (Consensus Verification)', () => {
    it('reaches consensus when 2 of 3 providers confirm', async () => {
      const { hash, salt } = hashOtp('123456');
      const otpRecord = {
        id: 'otp-1',
        otp_hash: hash,
        otp_salt: salt,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };

      chain.otpRecord = otpRecord;
      chain.orderRecord = { id: 'order-1', status: 'in_transit', driver_id: 'd1', drop_lat: 12.9, drop_lng: 77.5 };

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: '123456',
        gpsCoordinates: { lat: 12.9, lng: 77.5 },
      });

      expect(result.confirmed).toBe(true);
      expect(result.consensusCount).toBeGreaterThanOrEqual(2);
      expect(result.threshold).toBe(2);
      expect(result.providerResults).toHaveLength(3);
    });

    it('does not reach consensus with fewer than 2 confirmations', async () => {
      chain.orderRecord = { id: 'order-1', status: 'delivered' };
      chain.otpRecord = null;

      const result = await service.confirmDelivery({
        orderId: 'order-1',
        otp: 'wrong',
        gpsCoordinates: null,
      });

      expect(result.confirmed).toBe(false);
      expect(result.consensusCount).toBeLessThan(2);
    });
  });

  describe('_verifyOTP', () => {
    it('returns confirmed when order.otp_verified is already true', async () => {
      chain.orderRecord = { id: 'order-1', otp_verified: true };
      chain.otpRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(true);
    });

    it('fails when order is not found', async () => {
      chain.orderRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('Order not found');
    });

    it('fails when no OTP record exists for order', async () => {
      chain.orderRecord = { id: 'order-1', otp_verified: false };
      chain.otpRecord = null;
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('No OTP record found for order');
    });

    it('fails for an expired OTP', async () => {
      chain.orderRecord = { id: 'order-1', otp_verified: false };
      chain.otpRecord = {
        id: 'otp-1',
        otp_hash: 'hash',
        expires_at: new Date(Date.now() - 60000).toISOString(),
      };
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('OTP expired');
    });

    it('handles database error gracefully', async () => {
      chain.error = { message: 'Database connection failed' };
      const result = await service._verifyOTP('order-1', '123456');
      expect(result.confirmed).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('_verifyGPS', () => {
    it('fails for invalid or out-of-range coordinates', async () => {
      expect((await service._verifyGPS('order-1', { lat: 100, lng: 77.5 })).confirmed).toBe(false);
      expect((await service._verifyGPS('order-1', { lat: 12.9, lng: 200 })).confirmed).toBe(false);
      expect((await service._verifyGPS('order-1', null)).confirmed).toBe(false);
      expect((await service._verifyGPS('order-1', { lat: 'invalid', lng: 77.5 })).confirmed).toBe(false);
    });

    it('fails when order is not found', async () => {
      chain.orderRecord = null;
      const result = await service._verifyGPS('order-1', { lat: 12.9, lng: 77.5 });
      expect(result.confirmed).toBe(false);
      expect(result.reason).toBe('Order not found');
    });
  });

  describe('_verifyOrderStatus', () => {
    it('confirms for in-progress statuses', async () => {
      for (const status of ['picked_up', 'in_transit', 'arriving']) {
        chain.orderRecord = { id: 'order-1', status };
        const result = await service._verifyOrderStatus('order-1');
        expect(result.confirmed).toBe(true);
      }
    });

    it('rejects terminal or invalid statuses', async () => {
      for (const status of ['delivered', 'payment_released', 'cancelled', 'created']) {
        chain.orderRecord = { id: 'order-1', status };
        const result = await service._verifyOrderStatus('order-1');
        expect(result.confirmed).toBe(false);
      }
    });

    it('handles database errors during status verification', async () => {
      chain.error = { message: 'DB connection down' };
      const result = await service._verifyOrderStatus('order-1');
      expect(result.confirmed).toBe(false);
      expect(result.error).toBe('DB connection down');
    });
  });

  describe('verifyCrossChain', () => {
    const validHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    it('rejects invalid blockchain transaction hash format', async () => {
      const result = await service.verifyCrossChain('order-1', 'invalid-hash');
      expect(result.verified).toBe(false);
      expect(result.code).toBe('INVALID_BLOCKCHAIN_HASH');
    });

    it('verifies when hash matches and escrow is funded', async () => {
      chain.orderRecord = {
        id: 'order-1',
        blockchain_tx_hash: validHash,
        escrow_status: 'funded',
      };
      const result = await service.verifyCrossChain('order-1', validHash);
      expect(result.verified).toBe(true);
      expect(result.verificationUrl).toBe(`https://polygonscan.com/tx/${validHash}`);
    });

    it('fails when escrow is not funded or released', async () => {
      chain.orderRecord = {
        id: 'order-1',
        blockchain_tx_hash: validHash,
        escrow_status: 'pending',
      };
      const result = await service.verifyCrossChain('order-1', validHash);
      expect(result.verified).toBe(false);
    });

    it('fails when order is not found', async () => {
      chain.orderRecord = null;
      const result = await service.verifyCrossChain('order-1', validHash);
      expect(result.verified).toBe(false);
      expect(result.error).toBe('Order not found');
    });
  });
});
