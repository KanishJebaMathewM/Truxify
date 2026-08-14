import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ethers } from 'ethers'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { default: BatchCallBuilder, ESCROW_ABI, REPUTATION_ABI } = await import('../../src/services/blockchain/batchCallBuilder.js')

const ESCROW_IFACE = new ethers.Interface(ESCROW_ABI)
const REPUTATION_IFACE = new ethers.Interface(REPUTATION_ABI)

const BOOKING_RESULT = {
  customer: '0x' + 'c'.repeat(40),
  driver: '0x' + 'd'.repeat(40),
  amount: 1000n,
  status: 1,
  paid: false,
  started: true,
  createdAt: 1700000000n,
  disputedAt: 0n,
}

const CONTRACT_SOURCES = [
  ['../../../../blockchain/contracts/TruxifyEscrow.sol', ['function getBooking(uint256 bookingId)', 'mapping(address => uint256) public pendingWithdrawals']],
  ['../../../../blockchain/contracts/Reputation.sol', ['function getReputation(address driver)']],
]

describe('BatchCallBuilder', () => {
  let builder

  beforeEach(() => {
    process.env.ESCROW_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001'
    process.env.REPUTATION_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000002'
    builder = new BatchCallBuilder({ provider: null })
  })

  describe('ABI matches the real contract sources', () => {
    it.each(CONTRACT_SOURCES)('%s declares every ABI function', (path, signatures) => {
      const url = new URL(path, import.meta.url)
      const source = readFileSync(fileURLToPath(url), 'utf8')
      for (const signature of signatures) {
        expect(source).toContain(signature)
      }
    })
  })

  describe('buildPaymentStatusCall', () => {
    it('encodes getBooking and decodes the booking status', () => {
      const call = builder.buildPaymentStatusCall(7)
      expect(call.target).toBe(process.env.ESCROW_CONTRACT_ADDRESS)
      expect(call.callData.startsWith(ESCROW_IFACE.encodeFunctionData('getBooking', [7]).slice(0, 10))).toBe(true)
      const data = ESCROW_IFACE.encodeFunctionResult('getBooking', [
        BOOKING_RESULT.customer,
        BOOKING_RESULT.driver,
        BOOKING_RESULT.amount,
        BOOKING_RESULT.status,
        BOOKING_RESULT.paid,
        BOOKING_RESULT.started,
        BOOKING_RESULT.createdAt,
        BOOKING_RESULT.disputedAt,
      ])
      expect(call.decodeFn(data)).toEqual({ status: 1n })
    })
  })

  describe('buildDriverBalanceCall', () => {
    it('encodes pendingWithdrawals and decodes the balance as a string', () => {
      const driver = '0x' + 'a'.repeat(40)
      const call = builder.buildDriverBalanceCall(driver)
      expect(call.target).toBe(process.env.ESCROW_CONTRACT_ADDRESS)
      const data = ESCROW_IFACE.encodeFunctionResult('pendingWithdrawals', [5000n])
      expect(call.decodeFn(data)).toEqual({ balance: '5000' })
    })
  })

  describe('buildReputationCall', () => {
    it('targets the reputation contract and decodes getReputation', () => {
      const driver = '0x' + 'b'.repeat(40)
      const call = builder.buildReputationCall(driver)
      expect(call.target).toBe(process.env.REPUTATION_CONTRACT_ADDRESS)
      const data = REPUTATION_IFACE.encodeFunctionResult('getReputation', [42n])
      expect(call.decodeFn(data)).toEqual({ score: '42' })
    })

    it('falls back to the escrow address when no reputation contract is configured', () => {
      process.env.REPUTATION_CONTRACT_ADDRESS = ''
      builder = new BatchCallBuilder({ provider: null })
      const call = builder.buildReputationCall('0x' + 'b'.repeat(40))
      expect(call.target).toBe(process.env.ESCROW_CONTRACT_ADDRESS)
    })
  })

  describe('buildShipmentCompletionBatch', () => {
    it('builds payment, driver balance and reputation calls only', () => {
      const calls = builder.buildShipmentCompletionBatch({
        bookingId: 1,
        driverAddress: '0x' + 'b'.repeat(40),
        insuranceClaimId: 2,
        geofenceIds: [10, 11],
      })
      expect(calls.length).toBe(3)
      expect(calls.every(call => call.callData && call.decodeFn)).toBe(true)
    })
  })

  describe('buildMultiShipmentBatch', () => {
    it('stamps each call with its shipment id', () => {
      const calls = builder.buildMultiShipmentBatch([
        { id: 1, bookingId: 1, driverAddress: '0x' + 'b'.repeat(40) },
        { id: 2, bookingId: 2, driverAddress: '0x' + 'c'.repeat(40) },
      ])
      expect(calls.length).toBe(6)
      expect(calls.slice(0, 3).every(call => call.shipmentId === 1)).toBe(true)
      expect(calls.slice(3).every(call => call.shipmentId === 2)).toBe(true)
    })
  })

  it('returns an error object for an unknown custom function', () => {
    const result = builder.buildCustomBatch([{ functionName: 'noSuchFunction', args: [] }])
    expect(result[0].error).toBeTruthy()
  })
})
