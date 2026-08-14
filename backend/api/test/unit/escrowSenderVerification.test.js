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

it('rejects an already-funded booking created by a non-customer address', async () => {
    mockBookings.mockResolvedValue({ amount: 1n, customer: '0x' + '7'.repeat(40), driver: driverAddr })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '1')
    expect(result.error).toMatch(/different wallet/i)
})

it('rejects an already-funded booking created for a different driver', async () => {
    mockBookings.mockResolvedValue({ amount: 1n, customer: someSender, driver: '0x' + '8'.repeat(40) })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '1')
    expect(result.error).toMatch(/different driver/i)
})

it('rejects an already-funded booking whose amount differs from the expected amount', async () => {
    mockBookings.mockResolvedValue({ amount: 1n, customer: someSender, driver: driverAddr })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '100')
    expect(result.error).toMatch(/does not match/i)
    expect(result.code).toBe('DEPOSIT_AMOUNT_MISMATCH')
})

it('succeeds on an already-funded booking that matches customer, driver, and amount', async () => {
    mockBookings.mockResolvedValue({ amount: 100n, customer: someSender, driver: driverAddr })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '100')
    expect(result.alreadyFunded).toBe(true)
})

it('rejects a deposit tx created for a different driver', async () => {
    mockParseTransaction.mockReturnValue({
        name: 'createBooking',
        args: [BigInt(bookingId), '0x' + '8'.repeat(40)],
    })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '1')
    expect(result.error).toMatch(/driver address does not match/i)
})

it('rejects a deposit tx whose value differs from the expected escrow amount (exact equality)', async () => {
    mockGetTransaction.mockResolvedValue({
        to: CONTRACT_ADDRESS,
        data: '0xdeadbeef',
        value: 1n,
        from: someSender,
    })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '100')
    expect(result.error).toMatch(/does not match/i)
    expect(result.error).toMatch(/less than/i)
    expect(result.code).toBe('DEPOSIT_AMOUNT_MISMATCH')
})

it('rejects a deposit tx that overpays the expected escrow amount', async () => {
    mockGetTransaction.mockResolvedValue({
        to: CONTRACT_ADDRESS,
        data: '0xdeadbeef',
        value: 1000n,
        from: someSender,
    })
    const result = await recordDepositTx(bookingId, txHash, someSender, driverAddr, '100')
    expect(result.error).toMatch(/does not match/i)
    expect(result.error).toMatch(/greater than/i)
    expect(result.code).toBe('DEPOSIT_AMOUNT_MISMATCH')
})

it('returns a 4xx-friendly error for a malformed booking ID instead of throwing', async () => {
    const result = await recordDepositTx('escrow:#FF20260600', txHash, someSender, driverAddr, '1')
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/invalid booking id/i)
})
})