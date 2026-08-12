/**
 * Unit tests for backend/api/src/services/digilockerService.js
 *
 * Coverage:
 *   - validateSetup: returns false when contracts not configured
 *   - validateSetup: returns true when both contracts respond to probes
 *   - validateSetup: returns false when a contract is missing bytecode
 *   - validateSetup: returns false when a contract ABI probe fails
 *
 * Run with:  npm test -- test/unit/digilockerService.test.js
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function unsetContractEnv() {
  delete process.env.POLYGON_RPC_URL
  delete process.env.RELAYER_WALLET_PRIVATE_KEY
  delete process.env.PRIVATE_KEY
  delete process.env.DOCUMENT_REGISTRY_CONTRACT
  delete process.env.KYC_VERIFIER_CONTRACT_ADDRESS
}

function setContractEnv() {
  process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com'
  process.env.RELAYER_WALLET_PRIVATE_KEY = '0x' + '11'.repeat(32)
  process.env.DOCUMENT_REGISTRY_CONTRACT = '0x' + '22'.repeat(20)
  process.env.KYC_VERIFIER_CONTRACT_ADDRESS = '0x' + '33'.repeat(20)
}

async function loadService() {
  vi.resetModules()
  const mod = await import('../../src/services/digilockerService.js')
  return mod.default
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV }
})

describe('digilockerService — validateSetup (contracts unconfigured)', () => {
  it('returns false when env vars are missing', async () => {
    unsetContractEnv()
    const service = await loadService()
    expect(await service.validateSetup()).toBe(false)
  })
})

describe('digilockerService — validateSetup (contracts configured)', () => {
  it('returns true when both contracts have bytecode and respond to probes', async () => {
    setContractEnv()
    const service = await loadService()

    expect(service.documentRegistry).toBeTruthy()
    expect(service.kycVerifier).toBeTruthy()

    const provider = service.documentRegistry.runner.provider
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x12345678')
    vi.spyOn(service.documentRegistry, 'getDocument').mockResolvedValue([
      '0x' + '00'.repeat(32),
      '',
      0n,
      false
    ])
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false)

    expect(await service.validateSetup()).toBe(true)
  })

  it('returns false when a contract has no bytecode at the configured address', async () => {
    setContractEnv()
    const service = await loadService()

    const provider = service.documentRegistry.runner.provider
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x')
    vi.spyOn(service.documentRegistry, 'getDocument').mockResolvedValue([])
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false)

    expect(await service.validateSetup()).toBe(false)
  })

  it('returns false when the ABI probe fails (address points at the wrong contract)', async () => {
    setContractEnv()
    const service = await loadService()

    const provider = service.documentRegistry.runner.provider
    vi.spyOn(provider, 'getCode').mockResolvedValue('0x12345678')
    vi.spyOn(service.documentRegistry, 'getDocument').mockRejectedValue(
      new Error('missing revert data in call exception')
    )
    vi.spyOn(service.kycVerifier, 'isVerified').mockResolvedValue(false)

    expect(await service.validateSetup()).toBe(false)
  })
})
