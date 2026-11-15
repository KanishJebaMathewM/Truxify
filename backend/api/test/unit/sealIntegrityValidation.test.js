import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  calculatePerceptualHash,
  verifyTrailerSealIntegrity,
  MAX_SEAL_IMAGE_BASE64_LENGTH,
} from '../../src/services/sealIntegrity.js';
import sealIntegrityRouter from '../../src/routes/sealIntegrity.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/seal-integrity', sealIntegrityRouter);

function repeatPayload(length) {
  return 'a'.repeat(length);
}

describe('seal integrity payload validation', () => {
  it('accepts a base64 payload exactly at the documented limit', () => {
    const payload = repeatPayload(MAX_SEAL_IMAGE_BASE64_LENGTH);

    expect(() => calculatePerceptualHash(payload)).not.toThrow();
    const result = verifyTrailerSealIntegrity({
      ebolId: 'ebol-limit',
      expectedSerial: 'SEAL-LIMIT',
      sealImageBase64: payload,
    });

    expect(result.imageProof.imageHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an oversized base64 payload with a 413 before hashing', () => {
    const payload = repeatPayload(MAX_SEAL_IMAGE_BASE64_LENGTH + 1);

    expect(() => calculatePerceptualHash(payload)).toThrowError(
      `imageInput exceeds the maximum length of ${MAX_SEAL_IMAGE_BASE64_LENGTH} characters.`
    );

    try {
      verifyTrailerSealIntegrity({
        ebolId: 'ebol-oversized',
        expectedSerial: 'SEAL-BIG',
        sealImageBase64: payload,
      });
      throw new Error('expected oversized payload to be rejected');
    } catch (error) {
      expect(error.statusCode).toBe(413);
    }
  });

  it('rejects non-string image inputs with a 400', () => {
    expect(() => calculatePerceptualHash(42)).toThrowError(
      'imageInput must be a base64 string.'
    );

    try {
      verifyTrailerSealIntegrity({
        ebolId: 'ebol-type',
        expectedSerial: 'SEAL-TYPE',
        sealImageBase64: ['not', 'a', 'string'],
      });
      throw new Error('expected non-string payload to be rejected');
    } catch (error) {
      expect(error.statusCode).toBe(400);
    }
  });

  it('returns 413 from the verify route for an oversized payload', async () => {
    const response = await request(app)
      .post('/api/seal-integrity/verify')
      .send({
        ebolId: 'ebol-route-big',
        expectedSerial: 'SEAL-ROUTE-BIG',
        sealImageBase64: repeatPayload(MAX_SEAL_IMAGE_BASE64_LENGTH + 1),
      });

    expect(response.status).toBe(413);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('maximum length');
  });

  it('returns 400 from the compare route for a non-string payload', async () => {
    const response = await request(app)
      .post('/api/seal-integrity/compare-hashes')
      .send({
        imageBase64A: { nested: true },
        imageBase64B: 'c2VhbA==',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('must be a base64 string');
  });
});
