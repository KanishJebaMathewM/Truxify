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
    constructor(...args) {
      mocks.contractArgs = args;
      return mocks.contract
    }
  }

  const mockEthers = {
    ...actual,
    JsonRpcProvider: MockProvider,
    Wallet: MockWallet,
    Contract: MockContract,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: MockProvider,
      Wallet: MockWallet,
      Contract: MockContract,
    }
  }

  return mockEthers
})

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: { from: vi.fn() },
}))

vi.mock('../../src/middleware/logger.js', () => ({
  default: mocks.logger,
}))

process.env.PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001'
// The service disables itself unless all three are set (deliberate config hardening).
process.env.POLYGON_RPC_URL = 'http://localhost:8545'
process.env.ASSET_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000002'

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
  it('requires a verified user signer — the server-wallet fallback was removed', async () => {
    // The 8a1021fe04 fallback (signer || this.wallet) let the platform's
    // wallet sell users' fractions — deliberately reverted; missing signer
    // now fails closed.
    await expect(tokenService.sellFraction(7, 2, signer.address)).rejects.toThrow(
      'A verified user signer is required to sell fractions.',
    )
    expect(mocks.contract.sellFraction).not.toHaveBeenCalled()
    expect(tokenService.storeTransaction).not.toHaveBeenCalled()
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
