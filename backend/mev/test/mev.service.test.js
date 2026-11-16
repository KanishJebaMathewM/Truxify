import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const mockRelayer = vi.hoisted(() => ({
    assemblePrivateBundle: vi.fn(),
    sendPrivateBundle: vi.fn(),
}));

// Mock dependencies before importing the service
vi.mock('../flashbots_relayer.js', () => {
    return {
        getMevRelayer: vi.fn(() => mockRelayer),
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
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null })
    }
}));

import mevService from '../mev.service.js';
import { getMevRelayer } from '../flashbots_relayer.js';

describe('MEVService - Flashbots Relayer Integration', () => {
    const originalPrivateRelay = process.env.MEV_PRIVATE_RELAY;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.MEV_PRIVATE_RELAY = 'true';
        process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '2'.repeat(64);
        // Mock updateEscrowStatus since it calls supabase and might fail if not mocked perfectly
        mevService.updateEscrowStatus = vi.fn().mockResolvedValue(true);
    });

    afterAll(() => {
        if (originalPrivateRelay === undefined) {
            delete process.env.MEV_PRIVATE_RELAY;
        } else {
            process.env.MEV_PRIVATE_RELAY = originalPrivateRelay;
        }
        delete process.env.RELAYER_WALLET_PRIVATE_KEY;
    });

    it('should use flashbots_relayer to send private bundle during bundle submission', async () => {
        // Setup mocks for the relayer
        mockRelayer.sendPrivateBundle.mockResolvedValue({
            success: true,
            bundleHash: '0xbundlehash',
            targetBlock: 1001
        });

        // Act
        const result = await mevService.submitFlashbotsBundle('escrow-1', [{ to: '0xabc', value: 1 }]);

        // Assert
        expect(getMevRelayer).toHaveBeenCalled();
        expect(mockRelayer.sendPrivateBundle).toHaveBeenCalledWith({
            signedBundle: ['0xsignedTx'],
            targetBlock: 1001 // target block (1000 + 1)
        });
        expect(result).toEqual({
            success: true,
            bundleHash: '0xbundlehash',
            targetBlock: 1001
        });
    });
});
