import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ethers } from 'ethers'

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { default: BatchCallBuilder } = await import('../../src/services/blockchain/batchCallBuilder.js')

const IFACE = new ethers.Interface([
  'function getPaymentStatus(uint256 bookingId) view returns (uint8)',
  'function getDriverBalance(address driver) view returns (uint256)',
  'function getInsuranceCoverage(uint256 claimId) view returns (bool, uint256)',
  'function getGeofenceStatus(uint256 shipmentId) view returns (bool)',
  'function getReputationScore(address driver) view returns (uint256)',
])

describe('BatchCallBuilder', () => {
  let builder

  beforeEach(() => {
    process.env.ESCROW_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001'
    builder = new BatchCallBuilder({ provider: null })
  })

  it('builds a payment status call and decodes its result', () => {
    const call = builder.buildPaymentStatusCall(1)
    expect(call.target).toBe(process.env.ESCROW_CONTRACT_ADDRESS)
    const data = IFACE.encodeFunctionResult('getPaymentStatus', [5])
    expect(call.decodeFn(data)).toEqual({ status: 5n })
  })

  it('builds a driver balance call and decodes it as a string', () => {
    const call = builder.buildDriverBalanceCall('0x' + 'a'.repeat(40))
    const data = IFACE.encodeFunctionResult('getDriverBalance', [1000n])
    expect(call.decodeFn(data)).toEqual({ balance: '1000' })
  })

  it('builds an insurance call returning approved and amount', () => {
    const call = builder.buildInsuranceCall(3)
    const data = IFACE.encodeFunctionResult('getInsuranceCoverage', [true, 250n])
    expect(call.decodeFn(data)).toEqual({ approved: true, amount: '250' })
  })

  it('appends geofence calls when geofenceIds are present', () => {
    const calls = builder.buildShipmentCompletionBatch({
      bookingId: 1,
      driverAddress: '0x' + 'b'.repeat(40),
      insuranceClaimId: 2,
      geofenceIds: [10, 11],
    })
    // base batch (3) + reputation (1) + 2 geofence calls
    expect(calls.length).toBe(6)
  })

  it('builds a batch without geofence calls when none are present', () => {
    const calls = builder.buildShipmentCompletionBatch({
      bookingId: 1,
      driverAddress: '0x' + 'b'.repeat(40),
      insuranceClaimId: 2,
    })
    expect(calls.length).toBe(4)
  })

  it('returns an error object for an unknown custom function', () => {
    const result = builder.buildCustomBatch([{ functionName: 'noSuchFunction', args: [] }])
    expect(result[0].error).toBeTruthy()
  })
})
