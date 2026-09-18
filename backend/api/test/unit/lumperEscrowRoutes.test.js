import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

let mockCurrentUser = { id: 'user-broker-1', role: 'broker' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockCurrentUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const lumperEscrowServiceMock = vi.hoisted(() => ({
  depositLumperFee: vi.fn(),
  processReceiptAndRelease: vi.fn(),
  getEscrowStatus: vi.fn(),
}));

vi.mock('../../src/services/lumperEscrowService.js', () => ({
  lumperEscrowService: lumperEscrowServiceMock,
}));

const {
  default: lumperEscrowRouter,
  isValidEvmAddress,
  isValidReceiptUrl,
} = await import('../../src/routes/lumperEscrowRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/lumper-escrow', lumperEscrowRouter);
  return app;
}

describe('lumperEscrowRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = { id: 'user-broker-1', role: 'broker' };
  });

  describe('Validation Helpers', () => {
    it('validates EVM wallet addresses correctly', () => {
      expect(isValidEvmAddress('0x71C8418320499D12345678901234567890123456')).toBe(true);
      expect(isValidEvmAddress('0xabcdef0123456789abcdef0123456789abcdef01')).toBe(true);
      expect(isValidEvmAddress('0x123')).toBe(false);
      expect(isValidEvmAddress('not-an-address')).toBe(false);
      expect(isValidEvmAddress(null)).toBe(false);
      expect(isValidEvmAddress(undefined)).toBe(false);
    });

    it('validates receipt URLs correctly', () => {
      expect(isValidReceiptUrl('https://storage.truxify.com/receipts/rec-123.jpg')).toBe(true);
      expect(isValidReceiptUrl('http://insecure-cdn.truxify.com/receipts/rec-456.png')).toBe(true);
      expect(isValidReceiptUrl('ftp://insecure-host/file.jpg')).toBe(false);
      expect(isValidReceiptUrl('javascript:alert(1)')).toBe(false);
      expect(isValidReceiptUrl('not-a-url')).toBe(false);
      expect(isValidReceiptUrl(null)).toBe(false);
    });
  });

  describe('POST /api/lumper-escrow/deposit', () => {
    const validPayload = {
      booking_id: 'BK-10928',
      broker_address: '0x71C8418320499D12345678901234567890123456',
      estimated_fee: 350.50,
    };

    it('successfully deposits lumper fee when requested by authorized broker', async () => {
      mockCurrentUser = { id: 'broker-42', role: 'broker' };
      const mockResult = {
        escrowId: 'LMP-BK-10928-171000',
        bookingId: 'BK-10928',
        brokerAddress: validPayload.broker_address,
        estimatedFeeAmount: 350.50,
        status: 'HELD_IN_ESCROW',
        txHash: '0x' + 'a'.repeat(64),
      };
      lumperEscrowServiceMock.depositLumperFee.mockResolvedValue(mockResult);

      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/successfully deposited/i);
      expect(res.body.escrow).toEqual(mockResult);
      expect(lumperEscrowServiceMock.depositLumperFee).toHaveBeenCalledWith({
        bookingId: 'BK-10928',
        brokerAddress: validPayload.broker_address,
        estimatedFeeAmount: 350.50,
      });
    });

    it('allows admin role to execute deposit', async () => {
      mockCurrentUser = { id: 'admin-1', role: 'admin' };
      lumperEscrowServiceMock.depositLumperFee.mockResolvedValue({ escrowId: 'LMP-1' });

      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send(validPayload);

      expect(res.status).toBe(201);
    });

    it('rejects unauthorized role (e.g. shipper or driver) with 403 Forbidden', async () => {
      mockCurrentUser = { id: 'driver-7', role: 'driver' };

      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send(validPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
      expect(lumperEscrowServiceMock.depositLumperFee).not.toHaveBeenCalled();
    });

    it('rejects missing booking_id or broker_address or fee with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send({ booking_id: 'BK-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('rejects invalid EVM broker address with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send({
          ...validPayload,
          broker_address: 'invalid-address',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid broker_address/i);
    });

    it('rejects negative or zero estimated fee with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send({
          ...validPayload,
          estimated_fee: -20,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive finite number/i);
    });

    it('rejects excessive estimated fee above safety threshold with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send({
          ...validPayload,
          estimated_fee: 15000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/exceeds maximum permissible limit/i);
    });

    it('handles unexpected service error with 500', async () => {
      lumperEscrowServiceMock.depositLumperFee.mockRejectedValue(new Error('Contract RPC timeout'));

      const res = await request(makeApp())
        .post('/api/lumper-escrow/deposit')
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Contract RPC timeout');
    });
  });

  describe('POST /api/lumper-escrow/release', () => {
    const validReleasePayload = {
      escrow_id: 'LMP-BK-10928-171000',
      driver_wallet: '0x9999999999999999999999999999999999999999',
      receipt_url: 'https://cdn.truxify.com/receipts/rec-77.jpg',
      claimed_amount: 320,
    };

    beforeEach(() => {
      mockCurrentUser = { id: 'driver-10', role: 'driver' };
    });

    it('successfully releases funds when driver submits valid receipt', async () => {
      const mockReleased = {
        escrowId: validReleasePayload.escrow_id,
        driverWallet: validReleasePayload.driver_wallet,
        status: 'RELEASED_TO_DRIVER',
        claimedAmount: 320,
      };
      lumperEscrowServiceMock.processReceiptAndRelease.mockResolvedValue(mockReleased);

      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send(validReleasePayload);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/receipt verified and funds released/i);
      expect(res.body.escrow).toEqual(mockReleased);
    });

    it('allows admin role to release lumper funds', async () => {
      mockCurrentUser = { id: 'admin-1', role: 'admin' };
      lumperEscrowServiceMock.processReceiptAndRelease.mockResolvedValue({ status: 'RELEASED_TO_DRIVER' });

      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send(validReleasePayload);

      expect(res.status).toBe(200);
    });

    it('denies access to unauthorized broker role with 403 Forbidden', async () => {
      mockCurrentUser = { id: 'broker-1', role: 'broker' };

      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send(validReleasePayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });

    it('validates missing required release fields with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send({ escrow_id: 'LMP-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required parameters/i);
    });

    it('validates driver_wallet EVM formatting with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send({
          ...validReleasePayload,
          driver_wallet: '0xinvalid',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid driver_wallet/i);
    });

    it('validates receipt_url format with 400', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send({
          ...validReleasePayload,
          receipt_url: 'ftp://unsafe-link.org/file.pdf',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid receipt_url/i);
    });

    it('validates claimed_amount bounds with 400 if provided negatively', async () => {
      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send({
          ...validReleasePayload,
          claimed_amount: -50,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/positive finite number/i);
    });

    it('returns 404 when escrow contract is not found', async () => {
      lumperEscrowServiceMock.processReceiptAndRelease.mockRejectedValue(
        new Error('Lumper escrow not found for ID: LMP-999')
      );

      const res = await request(makeApp())
        .post('/api/lumper-escrow/release')
        .send(validReleasePayload);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('GET /api/lumper-escrow/:escrowId', () => {
    it('returns escrow details when record exists', async () => {
      const mockRecord = {
        escrowId: 'LMP-BK-10928-171000',
        bookingId: 'BK-10928',
        status: 'HELD_IN_ESCROW',
      };
      lumperEscrowServiceMock.getEscrowStatus.mockResolvedValue(mockRecord);

      const res = await request(makeApp())
        .get('/api/lumper-escrow/LMP-BK-10928-171000');

      expect(res.status).toBe(200);
      expect(res.body.escrow).toEqual(mockRecord);
    });

    it('returns 404 when escrow record does not exist', async () => {
      lumperEscrowServiceMock.getEscrowStatus.mockResolvedValue(null);

      const res = await request(makeApp())
        .get('/api/lumper-escrow/LMP-NONEXISTENT');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 500 when service fails unexpectedly', async () => {
      lumperEscrowServiceMock.getEscrowStatus.mockRejectedValue(new Error('DB failure'));

      const res = await request(makeApp())
        .get('/api/lumper-escrow/LMP-FAIL');

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Failed to retrieve/i);
    });
  });
});
