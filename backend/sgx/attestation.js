import crypto from 'crypto';

/**
 * Intel SGX Remote Attestation Node.js Bridge
 *
 * Attestation is gated behind ENCLAVE_ATTESTATION so that a fabricated quote is
 * never presented as a hardware-verified result:
 *
 *   - `none`  (default)  — no attestation is performed and the service fails
 *                          closed. This is the only safe default until a real
 *                          attestation provider (Intel SGX DCAP, Azure
 *                          attestation, RA-TLS verifier) is integrated.
 *   - `mock`  (opt-in)   — produces a simulated quote for local development.
 *                          The result is explicitly labelled
 *                          `attestationProvider: 'mock'` /
 *                          `hardwareBacked: false` and `verified` stays
 *                          `false`, so no consumer can mistake it for real
 *                          hardware attestation.
 *   - anything else      — a real provider was requested but none is wired up;
 *                          fail closed with an explicit reason.
 */
export class SgxAttestationService {
  constructor() {
    this.mode = (process.env.ENCLAVE_ATTESTATION || 'none').toLowerCase();
  }

  get enabled() {
    return this.mode !== 'none';
  }

  get provider() {
    if (this.mode === 'mock') return 'mock';
    if (this.mode !== 'none') return this.mode;
    return null;
  }

  async verifyDriverDocumentInEnclave(documentBase64) {
    const docHash = crypto.createHash('sha256').update(documentBase64).digest('hex');

    if (this.mode === 'none') {
      console.warn(
        '[SGX Enclave] Attestation disabled (ENCLAVE_ATTESTATION=none). ' +
        'No enclave-backed attestation was performed.'
      );
      return {
        success: false,
        verified: false,
        reason:
          'SGX attestation is not enabled. Set ENCLAVE_ATTESTATION to a real ' +
          'attestation provider before relying on enclave-backed results.',
        attestationQuote: null,
        attestationProvider: null,
        hardwareBacked: false,
        docHash,
        timestamp: Date.now(),
      };
    }

    if (this.mode === 'mock') {
      console.warn(
        '[SGX Enclave] Running in mock mode (ENCLAVE_ATTESTATION=mock). ' +
        'Results are NOT hardware-verified.'
      );
      const mockQuote = `SGX_QUOTE_V3_MOCK_${documentBase64.length}_${docHash.slice(0, 16)}`;
      return {
        success: true,
        verified: false,
        attestationQuote: mockQuote,
        attestationProvider: 'mock',
        hardwareBacked: false,
        docHash,
        timestamp: Date.now(),
      };
    }

    // A real provider was requested but no verification implementation is wired
    // up yet. Fail closed instead of fabricating a "valid" quote.
    console.warn(
      `[SGX Enclave] Attestation provider '${this.mode}' is not integrated. ` +
      'Failing closed — no attestation was performed.'
    );
    return {
      success: false,
      verified: false,
      reason:
        `SGX attestation provider '${this.mode}' is configured but not ` +
        'integrated. No enclave-backed attestation was performed.',
      attestationQuote: null,
      attestationProvider: this.mode,
      hardwareBacked: false,
      docHash,
      timestamp: Date.now(),
    };
  }
}

export const sgxAttestationService = new SgxAttestationService();
