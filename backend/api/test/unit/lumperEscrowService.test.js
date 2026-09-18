import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { LumperEscrowService } from '../../src/services/lumperEscrowService.js';


describe('LumperEscrowService', () => {
  let service;

  beforeEach(() => {
    service = new LumperEscrowService();
  });

  describe('depositLumperFee', () => {
    it('successfully deposits lumper fee into escrow contract for valid parameters', async () => {
      const result = await service.depositLumperFee({
        bookingId: 'BK-10023',
        brokerAddress: '0x1111222233334444555566667777888899990000',
        estimatedFeeAmount: 250,
      });

      expect(result).toBeDefined();
      expect(result.escrowId).toMatch(/^LMP-BK-10023-\d+$/);
      expect(result.bookingId).toBe('BK-10023');
      expect(result.brokerAddress).toBe('0x1111222233334444555566667777888899990000');
      expect(result.estimatedFeeAmount).toBe(250);
      expect(result.status).toBe('HELD_IN_ESCROW');
      expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.createdAt).toBeDefined();

      const retrieved = await service.getEscrowStatus(result.escrowId);
      expect(retrieved).toEqual(result);
    });

    it('rejects deposit when bookingId or brokerAddress is missing', async () => {
      await expect(
        service.depositLumperFee({
          brokerAddress: '0x1111222233334444555566667777888899990000',
          estimatedFeeAmount: 200,
        })
      ).rejects.toThrow('bookingId and brokerAddress are required');

      await expect(
        service.depositLumperFee({
          bookingId: 'BK-200',
          estimatedFeeAmount: 200,
        })
      ).rejects.toThrow('bookingId and brokerAddress are required');

      await expect(service.depositLumperFee()).rejects.toThrow(
        'bookingId and brokerAddress are required'
      );
    });

    it('rejects deposit when estimatedFeeAmount is zero, negative, or non-numeric', async () => {
      await expect(
        service.depositLumperFee({
          bookingId: 'BK-300',
          brokerAddress: '0xBroker',
          estimatedFeeAmount: 0,
        })
      ).rejects.toThrow('estimatedFeeAmount must be a positive number');

      await expect(
        service.depositLumperFee({
          bookingId: 'BK-301',
          brokerAddress: '0xBroker',
          estimatedFeeAmount: -50,
        })
      ).rejects.toThrow('estimatedFeeAmount must be a positive number');

      await expect(
        service.depositLumperFee({
          bookingId: 'BK-302',
          brokerAddress: '0xBroker',
          estimatedFeeAmount: 'invalid',
        })
      ).rejects.toThrow('estimatedFeeAmount must be a positive number');
    });
  });

  describe('getEscrowStatus', () => {
    it('returns null when escrow does not exist', async () => {
      const status = await service.getEscrowStatus('NON-EXISTENT-ID');
      expect(status).toBeNull();
    });
  });

  describe('processReceiptAndRelease', () => {
    let activeEscrow;

    beforeEach(async () => {
      activeEscrow = await service.depositLumperFee({
        bookingId: 'BK-ACTIVE-01',
        brokerAddress: '0xBroker123',
        estimatedFeeAmount: 180,
      });
    });

    it('successfully verifies receipt and releases funds with custom claimedAmount', async () => {
      const driverWallet = '0xDriverWallet789';
      const receiptImageUrl = 'https://s3.truxify.com/receipts/rec-01.jpg';

      const released = await service.processReceiptAndRelease({
        escrowId: activeEscrow.escrowId,
        driverWallet,
        receiptImageUrl,
        claimedAmount: 195,
      });

      expect(released.status).toBe('RELEASED');
      expect(released.releasedAmount).toBe(195);
      expect(released.driverWallet).toBe(driverWallet);
      expect(released.receiptImageUrl).toBe(receiptImageUrl);
      expect(released.releaseTxHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(released.releasedAt).toBeDefined();

      const stored = await service.getEscrowStatus(activeEscrow.escrowId);
      expect(stored.status).toBe('RELEASED');
      expect(stored.releasedAmount).toBe(195);
    });

    it('falls back to estimatedFeeAmount when claimedAmount is omitted', async () => {
      const released = await service.processReceiptAndRelease({
        escrowId: activeEscrow.escrowId,
        driverWallet: '0xDriver456',
        receiptImageUrl: 'https://s3.truxify.com/receipts/rec-default.jpg',
      });

      expect(released.status).toBe('RELEASED');
      expect(released.releasedAmount).toBe(180);
    });

    it('throws error when escrow ID is not found', async () => {
      await expect(
        service.processReceiptAndRelease({
          escrowId: 'LMP-UNKNOWN',
          driverWallet: '0xDriver',
          receiptImageUrl: 'https://example.com/receipt.jpg',
        })
      ).rejects.toThrow('Lumper fee escrow not found');
    });

    it('throws error to prevent double-release on already released escrow', async () => {
      await service.processReceiptAndRelease({
        escrowId: activeEscrow.escrowId,
        driverWallet: '0xDriverFirst',
        receiptImageUrl: 'https://s3.truxify.com/receipts/rec-1.jpg',
      });

      await expect(
        service.processReceiptAndRelease({
          escrowId: activeEscrow.escrowId,
          driverWallet: '0xDriverSecond',
          receiptImageUrl: 'https://s3.truxify.com/receipts/rec-2.jpg',
        })
      ).rejects.toThrow('Lumper fee escrow already released');
    });
  });
});
