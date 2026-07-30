/**
 * Centralized ML prediction validation.
 *
 * Every ML prediction must pass through `validatePricePrediction()` before
 * the result is consumed by the backend. This prevents NaN, Infinity,
 * negative prices, missing fields, and schema anomalies from reaching
 * pricing logic or database columns.
 *
 * The validator is stateless and reusable across all call sites.
 */

/**
 * Reason constants — machine-readable labels for why a prediction was
 * rejected.  Call sites and log consumers can filter on these.
 */
export const RejectionReason = Object.freeze({
  NULL_RESPONSE:       'null_response',
  MISSING_FIELD:       'missing_field',
  NOT_A_NUMBER:        'not_a_number',
  NAN:                 'nan',
  INFINITY:            'infinity',
  NEGATIVE:            'negative',
  ZERO:                'zero',
  BELOW_MIN:           'below_minimum',
  ABOVE_MAX:           'above_maximum',
  INVALID_CURRENCY:    'invalid_currency',
  INVALID_MIN_PRICE:   'invalid_min_price',
  INVALID_MAX_PRICE:   'invalid_max_price',
  INVALID_CONFIDENCE:  'invalid_confidence',
  UNEXPECTED_TYPE:     'unexpected_type',
});

/** Absolute floor price in INR — no legitimate freight prediction < ₹100. */
const MIN_PRICE_INR = 100;

/**
 * Absolute ceiling price in INR — no legitimate freight prediction > ₹500,000
 * for a single load in the East Africa corridor.
 */
const MAX_PRICE_INR = 500_000;

/**
 * Maximum acceptable ratio between max_price and estimated_price.
 * The ML model currently returns ±15% bands, so 3× is a generous ceiling.
 */
const MAX_BAND_RATIO = 3;

/**
 * Validate an ML price prediction response.
 *
 * Returns `{ ok: true, validated }` on success, or `{ ok: false, reason, detail }`
 * on failure.  The caller uses the `reason` to log the specific failure mode.
 *
 * @param {*} raw - The raw response from the ML engine (may be null, undefined,
 *   or any type).
 * @returns {{ ok: true, validated: ValidatedPrice } | { ok: false, reason: string, detail: string }}
 */
export function validatePricePrediction(raw) {
  // ── Null / undefined ────────────────────────────────────────────────
  if (raw === null || raw === undefined) {
    return reject(RejectionReason.NULL_RESPONSE, 'Prediction response is null or undefined');
  }

  // ── Type check ──────────────────────────────────────────────────────
  if (typeof raw !== 'object') {
    return reject(RejectionReason.UNEXPECTED_TYPE, `Expected object, got ${typeof raw}`);
  }

  // ── estimated_price (required) ──────────────────────────────────────
  if (!('estimated_price' in raw)) {
    return reject(RejectionReason.MISSING_FIELD, 'Missing required field: estimated_price');
  }
  const price = raw.estimated_price;
  if (typeof price !== 'number') {
    return reject(RejectionReason.NOT_A_NUMBER, `estimated_price is ${typeof price}, expected number`);
  }
  if (!Number.isFinite(price)) {
    if (Number.isNaN(price)) {
      return reject(RejectionReason.NAN, 'estimated_price is NaN');
    }
    return reject(RejectionReason.INFINITY, 'estimated_price is Infinity');
  }
  if (price <= 0) {
    return reject(price === 0 ? RejectionReason.ZERO : RejectionReason.NEGATIVE, `estimated_price must be > 0, got ${price}`);
  }
  if (price < MIN_PRICE_INR) {
    return reject(RejectionReason.BELOW_MIN, `estimated_price ${price} is below minimum ${MIN_PRICE_INR} INR`);
  }
  if (price > MAX_PRICE_INR) {
    return reject(RejectionReason.ABOVE_MAX, `estimated_price ${price} exceeds maximum ${MAX_PRICE_INR} INR`);
  }

  // ── currency (required) ─────────────────────────────────────────────
  if (!('currency' in raw)) {
    return reject(RejectionReason.MISSING_FIELD, 'Missing required field: currency');
  }
  if (raw.currency !== 'INR') {
    return reject(RejectionReason.INVALID_CURRENCY, `Expected currency INR, got "${raw.currency}"`);
  }

  // ── min_price (optional but validated if present) ───────────────────
  if ('min_price' in raw) {
    if (typeof raw.min_price !== 'number' || !Number.isFinite(raw.min_price)) {
      return reject(RejectionReason.INVALID_MIN_PRICE, `min_price is not a finite number: ${raw.min_price}`);
    }
    if (raw.min_price > price) {
      return reject(RejectionReason.INVALID_MIN_PRICE, `min_price ${raw.min_price} exceeds estimated_price ${price}`);
    }
  }

  // ── max_price (optional but validated if present) ───────────────────
  if ('max_price' in raw) {
    if (typeof raw.max_price !== 'number' || !Number.isFinite(raw.max_price)) {
      return reject(RejectionReason.INVALID_MAX_PRICE, `max_price is not a finite number: ${raw.max_price}`);
    }
    if (raw.max_price < price) {
      return reject(RejectionReason.INVALID_MAX_PRICE, `max_price ${raw.max_price} is below estimated_price ${price}`);
    }
    if (raw.max_price > price * MAX_BAND_RATIO) {
      return reject(RejectionReason.INVALID_MAX_PRICE, `max_price ${raw.max_price} exceeds ${MAX_BAND_RATIO}× estimated_price ${price}`);
    }
  }

  // ── confidence (optional but validated if present) ──────────────────
  if ('confidence' in raw) {
    if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)) {
      return reject(RejectionReason.INVALID_CONFIDENCE, `confidence is not a finite number: ${raw.confidence}`);
    }
    if (raw.confidence < 0 || raw.confidence > 1) {
      return reject(RejectionReason.INVALID_CONFIDENCE, `confidence must be 0..1, got ${raw.confidence}`);
    }
  }

  // ── All checks passed ───────────────────────────────────────────────
  return {
    ok: true,
    validated: {
      estimated_price: roundPrice(price),
      min_price: 'min_price' in raw ? roundPrice(raw.min_price) : roundPrice(price * 0.85),
      max_price: 'max_price' in raw ? roundPrice(raw.max_price) : roundPrice(price * 1.15),
      currency: raw.currency,
      confidence: 'confidence' in raw ? raw.confidence : null,
    },
  };
}

/**
 * Convert a validated ML price from INR to paisa (integer).
 * Returns null if price is not a finite number.
 *
 * @param {number} priceInInr - Price in INR
 * @returns {number|null} Price in paisa (rounded to nearest integer)
 */
export function convertToPaisa(priceInInr) {
  if (typeof priceInInr !== 'number' || !Number.isFinite(priceInInr)) {
    return null;
  }
  return Math.round(priceInInr * 100);
}

function reject(reason, detail) {
  return { ok: false, reason, detail };
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

export const __testing = { MIN_PRICE_INR, MAX_PRICE_INR, MAX_BAND_RATIO };
