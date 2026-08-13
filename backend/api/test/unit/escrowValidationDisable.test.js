/**
 * Unit tests for escrow.js validation-failure deactivation (issue #11193).
 *
 * When the escrow env vars are set but validateEscrowSetup() fails — either
 * because no bytecode exists at ESCROW_CONTRACT_ADDRESS or because the
 * contract does not respond to the expected ABI — the module must deactivate
 * the contract client (escrowContract = null) so that:
 *   - isEscrowEnabled() returns false
 *   - every escrow operation returns { txData: null } / null immediately
 *   - checkEscrowHealth() reports status 'not_configured'
 *
 * Previously the client stayed initialised after a failed validation, so
 * isEscrowEnabled() returned true and contract calls failed at runtime.
 *
 * Run with:  npm test -- test/unit/escrowValidationDisable.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => {
  process.env.POLYGON_RPC_URL = 'https://mock-rpc.example.com'
  process.env.ESCROW_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001'
  process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '11'.repeat(32)
  return {
    getCodeValue: '0x',
    probeThrows: true,
  }
})

vi.mock('ethers', () => {
  class MockJsonRpcProvider {
    constructor (url) {
      this.url = url
    }

    async getCode () {
      return state.getCodeValue
    }
  }

  class MockWallet {
    constructor (privateKey, provider) {
      this.privateKey = privateKey
      this.provider = provider
    }

    async signMessage () {
      return '0x' + '22'.repeat(32)
    }
  }

  class MockContract {
    constructor (address, abi, runner) {
      this.address = address
      this.target = address
      this.runner = runner
    }

    async bookings () {
      if (state.probeThrows) {
        throw new Error('UNPREDICTABLE_GAS_LIMIT')
      }
      return []
    }
  }

  return {
    ethers: {
      JsonRpcProvider: MockJsonRpcProvider,
      Wallet: MockWallet,
      Contract: MockContract,
      solidityPackedKeccak256: () => '0x' + 'ab'.repeat(32),
      getBytes: (value) => value,
      isAddress: (value) => typeof value === 'string' && value.startsWith('0x'),
      isHexString: (value) => typeof value === 'string' && value.startsWith('0x'),
    },
  }
})

async function loadFreshEscrowModule () {
  vi.resetModules()
  return await import('../../src/services/escrow.js')
}

describe('escrow service — validateEscrowSetup deactivates client on failure', () => {
  beforeEach(() => {
    state.getCodeValue = '0x'
    state.probeThrows = true
  })

  it('returns false and disables escrow when no bytecode is deployed', async () => {
    state.getCodeValue = '0x'
    const escrow = await loadFreshEscrowModule()

    expect(await escrow.validateEscrowSetup()).toBe(false)

    expect(escrow.isEscrowEnabled()).toBe(false)

    const { txData, bookingId } = await escrow.buildDepositTx(
      '#FF20260611',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '1000000000000000000'
    )
    expect(txData).toBeNull()
    expect(bookingId.startsWith('0x')).toBe(true)

    const refund = await escrow.submitEscrowRefund('#FF20260611')
    expect(refund.txHash).toBeNull()
    expect(refund.bookingId.startsWith('0x')).toBe(true)

    const health = await escrow.checkEscrowHealth()
    expect(health.status).toBe('not_configured')
  })

  it('returns false and disables escrow when the ABI probe fails', async () => {
    state.getCodeValue = '0x600580600b6000396000f3'
    state.probeThrows = true
    const escrow = await loadFreshEscrowModule()

    expect(await escrow.validateEscrowSetup()).toBe(false)

    expect(escrow.isEscrowEnabled()).toBe(false)

    const { txData } = await escrow.buildDepositTx(
      '#FF20260612',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '1000000000000000000'
    )
    expect(txData).toBeNull()

    const health = await escrow.checkEscrowHealth()
    expect(health.status).toBe('not_configured')
  })

  it('returns true and keeps escrow enabled when validation passes', async () => {
    state.getCodeValue = '0x600580600b6000396000f3'
    state.probeThrows = false
    const escrow = await loadFreshEscrowModule()

    expect(await escrow.validateEscrowSetup()).toBe(true)
    expect(escrow.isEscrowEnabled()).toBe(true)
  })
})
