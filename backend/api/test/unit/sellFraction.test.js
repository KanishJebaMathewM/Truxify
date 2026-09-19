import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  contract: {
    sellFraction: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  wallet: {},
}))

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')

  class MockProvider {}

  class MockWallet {
    constructor() {
      return mocks.wallet
    }
  }

  class MockContract {
    constructor() {
      return mocks.contract
    }
  }

  return {
    ...actual,
    JsonRpcProvider: MockProvider,
    Wallet: MockWallet,
    Contract: MockContract,
  }
})

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: { from: vi.fn() },
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: mocks.logger,
}))

const { default: tokenService } = await import('../../../tokenization/token.service.js')

const signer = { address: '0x0000000000000000000000000000000000000001' }
const receipt = { hash: '0xsell-transaction' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.contract.sellFraction.mockResolvedValue({
    wait: vi.fn().mockResolvedValue(receipt),
  })
  tokenService.storeTransaction = vi.fn().mockResolvedValue(undefined)
})

describe('TokenizationService.sellFraction', () => {
  it('rejects a missing signer before attempting a blockchain transaction', async () => {
    await expect(
      tokenService.sellFraction(7, 2, signer.address),
    ).rejects.toThrow('A verified user signer is required to sell fractions.')

    expect(mocks.contract.sellFraction).not.toHaveBeenCalled()
    expect(tokenService.storeTransaction).not.toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Fraction sale failed:',
      expect.any(Error),
    )
  })

  it('submits the sell transaction with the caller signer and gas limit', async () => {
    const result = await tokenService.sellFraction(7, 2.5, signer.address, signer)

    expect(mocks.contract.sellFraction).toHaveBeenCalledWith(
      7,
      2500000000000000000n,
      { gasLimit: 150000 },
    )
    expect(tokenService.storeTransaction).toHaveBeenCalledWith({
      assetId: 7,
      userAddress: signer.address,
      amount: 2.5,
      type: 'sell',
      txHash: receipt.hash,
    })
    expect(result).toEqual({
      success: true,
      assetId: 7,
      amount: 2.5,
      txHash: receipt.hash,
    })
    expect(mocks.logger.info).toHaveBeenCalledWith('✅ Fraction sold: 7')
  })

  it('rethrows transaction failures after logging the sale error', async () => {
    const transactionError = new Error('transaction rejected')
    mocks.contract.sellFraction.mockRejectedValue(transactionError)

    await expect(
      tokenService.sellFraction(7, 1, signer.address, signer),
    ).rejects.toBe(transactionError)

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Fraction sale failed:',
      transactionError,
    )
    expect(tokenService.storeTransaction).not.toHaveBeenCalled()
  })
})
