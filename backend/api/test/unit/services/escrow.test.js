import { describe, it, expect, beforeEach, vi } from 'vitest';
const mockContract = {
    runner: {
        provider: {
            getNetwork: vi.fn(),
        },
    },
    createBooking: {
        populateTransaction: vi.fn(),
    },
    lockPayment: vi.fn(),
    commitmentNonces: vi.fn(),
};
vi.mock('../../../src/config/db.js', () => ({
    supabaseAdmin: {},
    supabase: {},
}));
vi.mock('../../../src/middleware/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));
vi.mock('../../../src/core/performanceMetrics.js', () => ({
    measureExecution: vi.fn((_name, fn) => fn()),
}));
vi.mock('../../../src/services/escrowCircuitBreaker.js', () => ({
    isEscrowPaused: vi.fn().mockResolvedValue(false),
    escrowPausedResult: vi.fn((bookingId) => ({
        txHash: null,
        bookingId,
        error: 'Escrow circuit breaker is paused',
    })),
}));
vi.mock('@sentry/node', () => ({
    captureException: vi.fn(),
}));
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ethers: {
            ...actual.ethers,
            Contract: vi.fn(function () {
                return mockContract;
            }),
            JsonRpcProvider: vi.fn(function () {
                return mockContract.runner.provider;
            }),
            Wallet: vi.fn(function () {
                return {
                    signMessage: vi.fn().mockResolvedValue('0x' + 'a'.repeat(130)),
                };
            }),
        },
    };
});
process.env.POLYGON_RPC_URL = 'http://mock-rpc';
process.env.ESCROW_CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + 'a'.repeat(64);
const {
    buildDepositTx,
    escrowLockPayment,
} = await import('../../../src/services/escrow.js');
const ORDER_ID = '#FF20260925';
const CUSTOMER = '0x0000000000000000000000000000000000000001';
const DRIVER = '0x0000000000000000000000000000000000000002';
const AMOUNT = '1000000000000000000';
beforeEach(() => {
    vi.clearAllMocks();
    mockContract.runner.provider.getNetwork.mockResolvedValue({
        chainId: 137,
    });
    mockContract.commitmentNonces.mockResolvedValue(0n);
    mockContract.createBooking.populateTransaction.mockResolvedValue({
        to: '0x1111111111111111111111111111111111111111',
        value: AMOUNT,
        data: '0xcreate',
    });
    mockContract.lockPayment.mockResolvedValue({
        hash: '0xlock',
        wait: vi.fn().mockResolvedValue({
            status: 1,
            hash: '0xlock-receipt',
            blockNumber: 100,
        }),
    });
});
describe('EscrowService (#12252)', () => {
    describe('escrow creation - buildDepositTx', () => {
        it('builds a deposit transaction for valid escrow details', async () => {
            const result = await buildDepositTx(
                ORDER_ID,
                CUSTOMER,
                DRIVER,
                AMOUNT
            );
            expect(result.txData).toEqual({
                to: '0x1111111111111111111111111111111111111111',
                value: AMOUNT,
                data: '0xcreate',
            });
            expect(result.bookingId).toMatch(/^0x[0-9a-f]{64}$/);
            expect(mockContract.createBooking.populateTransaction).toHaveBeenCalled();
        });
        it('rejects an invalid customer wallet address', async () => {
            const result = await buildDepositTx(
                ORDER_ID,
                'invalid-address',
                DRIVER,
                AMOUNT
            );
            expect(result.txData).toBeNull();
            expect(mockContract.createBooking.populateTransaction).not.toHaveBeenCalled();
        });
        it('rejects an invalid driver wallet address', async () => {
            const result = await buildDepositTx(
                ORDER_ID,
                CUSTOMER,
                'invalid-address',
                AMOUNT
            );
            expect(result.txData).toBeNull();
            expect(mockContract.createBooking.populateTransaction).not.toHaveBeenCalled();
        });
        it('rejects a zero escrow amount', async () => {
            const result = await buildDepositTx(
                ORDER_ID,
                CUSTOMER,
                DRIVER,
                '0'
            );
            expect(result.txData).toBeNull();
            expect(mockContract.createBooking.populateTransaction).not.toHaveBeenCalled();
        });
    });
    describe('escrow funding - escrowLockPayment', () => {
        it('locks the escrow amount successfully', async () => {
            const result = await escrowLockPayment(
                ORDER_ID,
                CUSTOMER,
                DRIVER,
                AMOUNT
            );
            expect(result).toEqual({
                txHash: '0xlock-receipt',
                bookingId: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            });
            expect(mockContract.lockPayment).toHaveBeenCalledWith(
                expect.any(String),
                CUSTOMER,
                DRIVER,
                { value: AMOUNT }
            );
        });
        it('returns an error when funding fails due to insufficient balance', async () => {
            mockContract.lockPayment.mockRejectedValueOnce(
                new Error('insufficient funds')
            );
            const result = await escrowLockPayment(
                ORDER_ID,
                CUSTOMER,
                DRIVER,
                AMOUNT
            );
            expect(result.txHash).toBeNull();
            expect(result.error).toBe('insufficient funds');
            expect(result.bookingId).toMatch(/^0x[0-9a-f]{64}$/);
        });
    });
});



