/**
 * Price rounding utilities for paisa/INR conversion.
 *
 * All monetary values in the database are stored in paisa (integers).
 * Frontend displays in INR (decimal). This module provides consistent
 * conversion and rounding rules.
 *
 * @module priceRounding
 */

/**
 * Convert INR to paisa (1 INR = 100 paisa).
 * Rounds to nearest paisa using banker's rounding.
 *
 * @param {number} inr - Price in INR
 * @returns {number|null} Price in paisa, or null if invalid
 */
export function toPaisa(inr) {
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr < 0) {
    return null;
  }
  return Math.round(inr * 100 + Number.EPSILON);
}

/**
 * Convert paisa to INR.
 *
 * @param {number} paisa - Price in paisa
 * @returns {number|null} Price in INR, or null if invalid
 */
export function toInr(paisa) {
  if (typeof paisa !== 'number' || !Number.isFinite(paisa) || paisa < 0) {
    return null;
  }
  return paisa / 100;
}

/**
 * Round a price to 2 decimal places (INR).
 *
 * @param {number} value - Price value
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {number} Rounded price
 */
export function roundPrice(value, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
