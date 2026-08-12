import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the service
vi.mock('../flashbots_relayer.js', () => {
    return {
        mevRelayer: {
            assemblePrivateBundle: vi.fn(),
            sendPrivateBundle: vi.fn(),
        }
    };
});

vi.mock('ethers', () => {
    return {
        ethers: {
            JsonRpcProvider: vi.fn().mockImplementation(function() {
                return { getBlockNumber: vi.fn().mockResolvedValue(1000) };
            }),
            Wallet: vi.fn().mockImplementation(function() {
                return { signTransaction: vi.fn().mockResolvedValue('0xsignedTx') };
            }),
            Contract: vi.fn().mockImplementation(function() {
                return { deposits: vi.fn(), releaseDepositPrivate: vi.fn() };
            }),
            keccak256: vi.fn().mockReturnValue('0xhash'),
            toUtf8Bytes: vi.fn(),
            formatEther: vi.fn(),
            parseEther: vi.fn(),
            Transaction: {
                from: vi.fn().mockReturnValue({ hash: '0xtxhash' })
            }
        }
    };
});

vi.mock('../../api/src/middleware/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    }
}));

vi.mock('../../api/src/config/db.js', () => ({
    supabase: {
        from: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null })
    }
}));

import mevService from '../mev.service.js';
import { mevRelayer } from '../flashbots_relayer.js';

describe('MEVService - Flashbots Relayer Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock updateEscrowStatus since it calls supabase and might fail if not mocked perfectly
        mevService.updateEscrowStatus = vi.fn().mockResolvedValue(true);
    });

    it('should use flashbots_relayer to send private bundle during releaseEscrow', async () => {
        // Setup mocks for the relayer
        const mockBundle = { signedBundle: ['0xmockTx'], targetBlock: 1001 };
        mevRelayer.assemblePrivateBundle.mockResolvedValue(mockBundle);
        mevRelayer.sendPrivateBundle.mockResolvedValue({
            success: true,
            bundleHash: '0xbundlehash',
            targetBlock: 1001
        });

        // Act
        const result = await mevService.releaseEscrow('123', 'secret-string');

        // Assert
        expect(mevRelayer.assemblePrivateBundle).toHaveBeenCalledWith(
            mevService.escrowAddress,
            mevService.escrowABI,
            'releaseDepositPrivate',
            ['123', 'secret-string'],
            1001 // target block (1000 + 1)
        );
        expect(mevRelayer.sendPrivateBundle).toHaveBeenCalledWith(mockBundle);
        expect(result).toEqual({
            success: true,
            txHash: '0xtxhash', // from ethers.Transaction.from
            bundleHash: '0xbundlehash'
        });
    });
});
