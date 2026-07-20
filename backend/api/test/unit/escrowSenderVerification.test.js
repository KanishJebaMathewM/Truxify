/**
 * Unit tests for recordDepositTx() sender verification (fail-closed check)
 * in backend/api/src/services/escrow.js — covers issue #1112.
 *
 * Mocks ethers so escrowContract is initialised (unlike the default
 * no-contract fallback tests), letting us reach the sender-verification
 * branch inside recordDepositTx().
 *
 * Run with: npm test -- test/unit/escrowSenderVerification.test.js
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const mockBookings = vi.fn()
const mockWaitForTransaction = vi.fn()
const mockGetTransaction = vi.fn()
const mockParseTransaction = vi.fn()

vi.mock('ethers', async (importOriginal) => {
const actual = await importOriginal()
return {
    ...actual,
    ethers: {
    ...actual.ethers,
    JsonRpcProvider: vi.fn(function () { return {} }),
    Wallet: vi.fn(function () { return {} }),
    Contract: vi.fn(function () {
        return {
            bookings: mockBookings,
            interface: { parseTransaction: mockParseTransaction },
            runner: {
            provider: {
                waitForTransaction: mockWaitForTransaction,
                getTransaction: mockGetTransaction,
            },
        },
    }
    }),
    },
}
})

const CONTRACT_ADDRESS = '0x' + 'c'.repeat(40)
const oldRpc = process.env.POLYGON_RPC_URL
const oldAddr = process.env.ESCROW_CONTRACT_ADDRESS
const oldKey = process.env.RELAYER_WALLET_PRIVATE_KEY

process.env.POLYGON_RPC_URL = 'http://localhost:8545'
process.env.ESCROW_CONTRACT_ADDRESS = CONTRACT_ADDRESS
process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '1'.repeat(64)

const { recordDepositTx, getEscrowBookingId } = await import('../../src/services/escrow.js')

afterAll(() => {
    if (oldRpc !== undefined) process.env.POLYGON_RPC_URL = oldRpc
    else delete process.env.POLYGON_RPC_URL
    if (oldAddr !== undefined) process.env.ESCROW_CONTRACT_ADDRESS = oldAddr
    else delete process.env.ESCROW_CONTRACT_ADDRESS
    if (oldKey !== undefined) process.env.RELAYER_WALLET_PRIVATE_KEY = oldKey
    else delete process.env.RELAYER_WALLET_PRIVATE_KEY
})

describe('recordDepositTx() — sender verification (fail-closed)', () => {
    const bookingId = getEscrowBookingId('#FF20260600')
    const txHash = '0x' + 'a'.repeat(64)
    const driverAddr = '0x' + '3'.repeat(40)
    const someSender = '0x' + '9'.repeat(40)

beforeEach(() => {
    mockBookings.mockResolvedValue({ amount: 0n })
    mockWaitForTransaction.mockResolvedValue({ status: 1, blockNumber: 100, hash: txHash })
    mockGetTransaction.mockResolvedValue({
        to: CONTRACT_ADDRESS,
        data: '0xdeadbeef',
        value: 0n,
        from: someSender,
    })
    mockParseTransaction.mockReturnValue({
        name: 'createBooking',
        args: [BigInt(bookingId), driverAddr],
    })
})

it('rejects with an error when no expectedSenderAddress is on file (fails closed)', async () => {
    const result = await recordDepositTx(bookingId, txHash, null)
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/no registered customer wallet/i)
})

it('rejects when tx.from does not match expectedSenderAddress', async () => {
    const wrongExpected = '0x' + '5'.repeat(40)
    const result = await recordDepositTx(bookingId, txHash, wrongExpected)
    expect(result.error).toMatch(/does not match/i)
})

it('succeeds when tx.from matches expectedSenderAddress', async () => {
    const result = await recordDepositTx(bookingId, txHash, someSender)
    expect(result.error).toBeUndefined()
    expect(result.txHash).toBe(txHash)
})
})