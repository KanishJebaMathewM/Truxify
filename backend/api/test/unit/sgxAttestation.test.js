import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SgxAttestationService, sgxAttestationService } from '../../../sgx/attestation.js';

const DOC = Buffer.from('{"document":"drivers-license"}').toString('base64');

function createService(mode) {
  vi.stubEnv('ENCLAVE_ATTESTATION', mode);
  return new SgxAttestationService();
}

describe('SgxAttestationService', () => {
  beforeEach(() => {
    delete process.env.ENCLAVE_ATTESTATION;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed when attestation is not enabled (default)', async () => {
    const service = createService('none');
    const result = await service.verifyDriverDocumentInEnclave(DOC);

    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.attestationQuote).toBeNull();
    expect(result.reason).toMatch(/not enabled/i);
    expect(result.docHash).toBeTruthy();
  });

  it('returns verified:false even in explicit mock mode', async () => {
    const service = createService('mock');
    const result = await service.verifyDriverDocumentInEnclave(DOC);

    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.hardwareBacked).toBe(false);
    expect(result.attestationProvider).toBe('mock');
    expect(result.attestationQuote).toMatch(/^SGX_QUOTE_V3_MOCK_/);
  });

  it('fails closed when a real provider is requested but not integrated', async () => {
    const service = createService('dcap');
    const result = await service.verifyDriverDocumentInEnclave(DOC);

    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.attestationQuote).toBeNull();
    expect(result.reason).toMatch(/not integrated/i);
  });

  it('never returns verified:true for a fabricated quote', async () => {
    const service = createService('mock');
    const result = await service.verifyDriverDocumentInEnclave(DOC);
    expect(result.verified).toBe(false);
  });

  it('exposes the configured provider and enabled flag', () => {
    expect(createService('mock').enabled).toBe(true);
    expect(createService('mock').provider).toBe('mock');
    expect(createService('none').enabled).toBe(false);
    expect(createService('none').provider).toBeNull();
  });

  it('exports a singleton service instance', () => {
    expect(sgxAttestationService).toBeInstanceOf(SgxAttestationService);
  });
});
