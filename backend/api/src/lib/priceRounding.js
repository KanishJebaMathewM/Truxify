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
 * Rounds down to nearest paisa using Math.floor.
 *
 * @param {number} inr - Price in INR
 * @returns {number|null} Price in paisa, or null if invalid
 */
export function toPaisa(inr) {
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr < 0) {
    return null;
  }
  return Math.floor(inr * 100);
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


// === ENTERPRISE PRICE EXTENSIONS (Issue #14102 Expansion) ===

/**
 * Formats paisa directly into a localized INR currency string (e.g., "?1,234.50").
 * 
 * @param {number} paisa - Price in integer paisa
 * @returns {string} Formatted currency string
 */
export function formatCurrencyInr(paisa) {
  const inr = toInr(paisa);
  if (inr === null) {
    return '?0.00';
  }
  return `?${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Calculates tax percentage on an amount in paisa and rounds securely.
 * 
 * @param {number} paisa - Base amount in paisa
 * @param {number} taxRatePercent - Tax percentage (e.g., 18 for GST)
 * @returns {object} Object containing base, taxPaisa, and totalPaisa
 */
export function calculateTaxAndRound(paisa, taxRatePercent) {
  if (typeof paisa !== 'number' || !Number.isFinite(paisa) || paisa < 0 ||
      typeof taxRatePercent !== 'number' || !Number.isFinite(taxRatePercent) || taxRatePercent < 0) {
    return { base: 0, taxPaisa: 0, totalPaisa: 0 };
  }
  
  const taxRaw = (paisa * taxRatePercent) / 100;
  const taxPaisa = Math.round(taxRaw + Number.EPSILON);
  const totalPaisa = paisa + taxPaisa;
  
  return {
    base: paisa,
    taxPaisa,
    totalPaisa
  };
}

/**
 * Safely splits a total paisa amount into equal parts with remainder penny distribution.
 * 
 * @param {number} totalPaisa - Total amount in paisa
 * @param {number} parts - Number of splits
 * @returns {number[]} Array of paisa amounts summing up exactly to totalPaisa
 */
export function splitAmountEqually(totalPaisa, parts) {
  if (typeof totalPaisa !== 'number' || !Number.isFinite(totalPaisa) || totalPaisa <= 0 ||
      typeof parts !== 'number' || !Number.isInteger(parts) || parts <= 0) {
    return [];
  }
  
  const baseShare = Math.floor(totalPaisa / parts);
  const remainder = totalPaisa % parts;
  const result = new Array(parts).fill(baseShare);
  
  for (let i = 0; i < remainder; i++) {
    result[i] += 1;
  }
  
  return result;
}

// Unified module export object for enterprise consumers
export const priceRounding = {
  toPaisa,
  toInr,
  roundPrice,
  formatCurrencyInr,
  calculateTaxAndRound,
  splitAmountEqually
};
