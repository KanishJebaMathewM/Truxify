import { describe, expect, it } from 'vitest';
import { encryptMessage, decryptMessage, hashMessage } from '../../src/lib/chatEncryption.js';
import {
  validateDocumentNumber,
  validateExtractedFields,
  checkOcrConfidence,
  checkExpiry,
  getDocumentRules,
  DOCUMENT_RULES,
} from '../../src/lib/documentValidator.js';

describe('chatEncryption', () => {
  const SECRET = 'chat-test-secret';

  it('encrypt → decrypt round-trip', () => {
    const msg = 'Load confirmed: 22 tonnes, Delhi → Mumbai, ₹85,000';
    const enc = encryptMessage(msg, SECRET);
    expect(enc).not.toBe(msg);
    expect(decryptMessage(enc, SECRET)).toBe(msg);
  });

  it('unique IV per message (same plaintext encrypts differently)', () => {
    expect(encryptMessage('same', SECRET)).not.toBe(encryptMessage('same', SECRET));
  });

  it('wrong secret fails authentication (GCM tag)', () => {
    const enc = encryptMessage('classified', SECRET);
    expect(() => decryptMessage(enc, 'wrong-secret')).toThrow();
  });

  it('tampered ciphertext fails authentication', () => {
    const enc = encryptMessage('authentic payload', SECRET);
    const tampered = enc.slice(0, -4) + (enc.endsWith('00') ? 'ff' : '00');
    expect(() => decryptMessage(tampered, SECRET)).toThrow();
  });

  it('passes through empty/missing inputs unchanged', () => {
    expect(encryptMessage('', SECRET)).toBe('');
    expect(encryptMessage('plain', '')).toBe('plain');
    expect(decryptMessage('', SECRET)).toBe('');
  });

  it('hashMessage is a deterministic sha256', () => {
    const h = hashMessage('check');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMessage('check')).toBe(h);
    expect(hashMessage('other')).not.toBe(h);
  });
});

describe('documentValidator', () => {
  it('validates DL numbers (MH0120110000001 shape)', () => {
    expect(validateDocumentNumber('DL', 'MH0120110000001').valid).toBe(true);
    expect(validateDocumentNumber('DL', 'mh01 20110000001').valid).toBe(true); // normalized
    expect(validateDocumentNumber('DL', '12345').valid).toBe(false);
  });

  it('validates RC numbers (MH01AB1234 shape)', () => {
    expect(validateDocumentNumber('RC', 'MH01AB1234').valid).toBe(true);
    expect(validateDocumentNumber('RC', 'MH-01-AB-1234').valid).toBe(false); // dashes not allowed
  });

  it('unknown types and missing numbers rejected', () => {
    expect(validateDocumentNumber('PASSPORT', 'X123').valid).toBe(false);
    expect(validateDocumentNumber('DL', '').valid).toBe(false);
    expect(validateDocumentNumber('DL', null).valid).toBe(false);
  });

  it('validateExtractedFields reports missing required fields', () => {
    const res = validateExtractedFields('DL', { name: 'Ram', dob: '1990-01-01' });
    expect(res.valid).toBe(false);
    // the parser emits 'valid_until' — the rules table uses that field name
    // (fixed in the documentVerification PR; 'validity' was a phantom name)
    expect(res.missingFields).toEqual(['valid_until']);
    const ok = validateExtractedFields('DL', { name: 'Ram', dob: '1990-01-01', valid_until: '2030-01-01' });
    expect(ok.valid).toBe(true);
  });

  it('checkOcrConfidence enforces per-document minimums', () => {
    expect(checkOcrConfidence('DL', 70)).toBe(true);
    expect(checkOcrConfidence('DL', 69)).toBe(false);
    expect(checkOcrConfidence('RC', 74)).toBe(false);
    expect(checkOcrConfidence('UNKNOWN', 100)).toBe(false);
  });

  it('checkExpiry: expired / warning window / healthy / missing', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const soon = new Date(Date.now() + 10 * 86400000).toISOString();
    const far = new Date(Date.now() + 365 * 86400000).toISOString();
    expect(checkExpiry(past).expired).toBe(true);
    const w = checkExpiry(soon, 30);
    expect(w.warning).toBe(true);
    expect(w.expired).toBe(false);
    expect(checkExpiry(far).warning).toBe(false);
    expect(checkExpiry(null).daysUntilExpiry).toBeNull();
  });

  it('every declared document type has complete rules', () => {
    for (const [type, rules] of Object.entries(DOCUMENT_RULES)) {
      expect(rules.name, type).toBeTruthy();
      expect(rules.numberRegex).toBeInstanceOf(RegExp);
      expect(rules.requiredFields.length).toBeGreaterThan(0);
      expect(rules.minOcrConfidence).toBeGreaterThan(0);
      expect(getDocumentRules(type)).toBe(rules);
    }
  });
});
