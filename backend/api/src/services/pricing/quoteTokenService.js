import crypto from 'crypto';
import logger from '../../middleware/logger.js';

export const DEFAULT_QUOTE_TTL_SECONDS = 900; // 15 minutes

export class QuoteTokenService {
  /**
   * @param {object} [options={}]
   * @param {string} [options.secret] - Secret key for HMAC signing
   * @param {number} [options.ttlSeconds=900] - 15 minutes
   */
  constructor(options = {}) {
    this.secret = options.secret || process.env.PRICING_QUOTE_SECRET || 'truxify_pricing_quote_hmac_secret_2026';
    this.ttlSeconds = options.ttlSeconds || DEFAULT_QUOTE_TTL_SECONDS;
  }

  /**
   * Generates an HMAC-SHA256 signature for quote parameters.
   * 
   * @private
   */
  _sign(payloadString) {
    return crypto.createHmac('sha256', this.secret).update(payloadString).digest('hex');
  }

  /**
   * Issues a time-limited cryptographically signed quote token.
   * 
   * @param {object} quoteData - { quoteId, totalPaisa, distanceKm, vehicleClass, breakdown }
   * @returns {object} { quoteToken, quoteId, expiresAt, totalPaisa }
   */
  generateQuoteToken(quoteData) {
    const quoteId = quoteData.quoteId || crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + (this.ttlSeconds * 1000);

    const payload = {
      quoteId,
      totalPaisa: quoteData.totalPaisa,
      baseFreightPaisa: quoteData.baseFreightPaisa,
      tollPaisa: quoteData.tollPaisa,
      fuelSurchargePaisa: quoteData.fuelSurchargePaisa,
      distanceKm: quoteData.distanceKm,
      vehicleClass: quoteData.vehicleClass,
      expiresAt,
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = this._sign(payloadBase64);

    const quoteToken = `${payloadBase64}.${signature}`;

    logger.debug({ quoteId, totalPaisa: quoteData.totalPaisa, expiresAt }, '[QuoteTokenService] Generated quote token');

    return {
      quoteToken,
      quoteId,
      expiresAt: new Date(expiresAt).toISOString(),
      ttlRemainingSeconds: this.ttlSeconds,
      totalPaisa: quoteData.totalPaisa,
    };
  }

  /**
   * Verifies the authenticity and expiration of a quote token.
   * 
   * @param {string} token - The base64url.signature token
   * @returns {{isValid: boolean, reason?: string, payload?: object}}
   */
  verifyQuoteToken(token) {
    try {
      if (!token || typeof token !== 'string') {
        return { isValid: false, reason: 'Missing quote token' };
      }

      const parts = token.split('.');
      if (parts.length !== 2) {
        return { isValid: false, reason: 'Malformed token structure' };
      }

      const [payloadBase64, signature] = parts;
      const expectedSignature = this._sign(payloadBase64);

      // Constant-time signature comparison to prevent timing attacks
      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return { isValid: false, reason: 'Invalid quote cryptographic signature' };
      }

      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf-8'));

      // Check Expiration (strict 15-minute TTL)
      if (Date.now() > payload.expiresAt) {
        const expiredSecondsAgo = Math.round((Date.now() - payload.expiresAt) / 1000);
        return {
          isValid: false,
          reason: `Quote token has expired ${expiredSecondsAgo} seconds ago (15-min TTL exceeded)`,
        };
      }

      return {
        isValid: true,
        payload,
      };
    } catch (err) {
      logger.error({ err }, '[QuoteTokenService] Error validating quote token');
      return { isValid: false, reason: `Token validation error: ${err.message}` };
    }
  }
}

export default QuoteTokenService;
