import crypto from 'crypto';

// Order display ids look like `#FF<YYYYMMDD><12-char alphanumeric>` so they
// stay human-friendly while the random suffix is drawn uniformly from a 36
// char alphabet (A-Z, 0-9) via crypto.randomInt — no modulo bias. That gives
// 36^12 ≈ 4.7e18 distinct values per calendar day, versus only ~900k for the
// previous 6-digit format, so collisions are effectively impossible. Callers
// still re-roll on a DB unique-constraint violation (code 23505) as a safety
// net (see ORDER_DISPLAY_ID_MAX_RETRIES).
const DISPLAY_ID_PREFIX = '#FF';
const DISPLAY_ID_RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DISPLAY_ID_RANDOM_LENGTH = 12;

// Upper bound on how many times a caller will re-roll the display id when an
// insert fails with a unique-constraint violation (issue #5740).
export const ORDER_DISPLAY_ID_MAX_RETRIES = 5;

/**
 * Generate a globally unique order display id of the form
 * `#FF<YYYYMMDD><12-char alphanumeric>` (e.g. `#FF20260802K9X2Q7Z4M1A3`).
 *
 * The display id is the basis for the on-chain escrow booking id
 * (getEscrowBookingId hashes `escrow:<displayId>`), so uniqueness is required
 * to keep orders and their escrow bookings 1:1.
 *
 * @returns {string} a display id with a ~4.7e18-per-day random space
 */
export function generateOrderDisplayId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Array.from(
    { length: DISPLAY_ID_RANDOM_LENGTH },
    () => DISPLAY_ID_RANDOM_ALPHABET[crypto.randomInt(DISPLAY_ID_RANDOM_ALPHABET.length)],
  ).join('');
  return `${DISPLAY_ID_PREFIX}${dateStr}${random}`;
}

export function isValidOrderDisplayId(displayId) {
  if (typeof displayId !== 'string') return false;
  return /^#FF\d{8}[A-Z0-9]{12}$/.test(displayId);
}

export function parseDisplayId(displayId) {
  if (displayId == null) {
    return { valid: false, error: 'null input' };
  }
  if (typeof displayId !== 'string') {
    return { valid: false, error: `expected string, got ${typeof displayId}` };
  }
  const valid = /^#FF\d{8}[A-Z0-9]{12}$/.test(displayId);
  if (!valid) {
    return { valid: false, error: 'Invalid order display id format' };
  }
  return { valid: true, displayId };
}


// === ENTERPRISE ORDER DISPLAY ID EXTENSIONS (Issue #14101 Expansion) ===

/**
 * Generates a batch of unique order display IDs concurrently for bulk checkout orders.
 * 
 * @param {number} count - Number of display IDs to generate
 * @returns {string[]} Array of unique order display IDs
 */
export function batchGenerateOrderDisplayIds(count) {
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || count > 1000) {
    return [];
  }
  
  const ids = new Set();
  // Ensure uniqueness in the generated batch run
  while (ids.size < count) {
    ids.add(generateOrderDisplayId());
  }
  
  return Array.from(ids);
}

/**
 * Extracts and parses the calendar date embedded within an order display ID.
 * 
 * @param {string} displayId - Order display ID (e.g. #FF20260802K9X2Q7Z4M1A3)
 * @returns {Date|null} Date object representing the order date, or null if invalid
 */
export function extractDateFromDisplayId(displayId) {
  const parsed = parseDisplayId(displayId);
  if (!parsed.valid) {
    return null;
  }
  
  // Extract YYYYMMDD substring starting at index 3 (#FF is index 0-2)
  const datePart = displayId.substring(3, 11);
  const year = parseInt(datePart.substring(0, 4), 10);
  const month = parseInt(datePart.substring(4, 6), 10) - 1; // JS months are 0-indexed
  const day = parseInt(datePart.substring(6, 8), 10);
  
  const dateObj = new Date(year, month, day);
  return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

// Unified enterprise utility module export
export const OrderDisplayIdManager = {
  generateOrderDisplayId,
  isValidOrderDisplayId,
  parseDisplayId,
  batchGenerateOrderDisplayIds,
  extractDateFromDisplayId,
  MAX_RETRIES: ORDER_DISPLAY_ID_MAX_RETRIES
};


// === ADVANCED BLOCKCHAIN ESCROW & BATCH UTILITIES (Issue #14101 Expansion) ===

/**
 * Formats an order display ID into the canonical escrow booking payload string.
 * 
 * @param {string} displayId - Valid order display ID
 * @returns {string|null} Canonical escrow string (e.g., "escrow:#FF20260802...") or null if invalid
 */
export function formatEscrowBookingPayload(displayId) {
  if (!isValidOrderDisplayId(displayId)) {
    return null;
  }
  return `escrow:${displayId}`;
}

/**
 * Validates an array of order display IDs in bulk and returns detailed status counts.
 * 
 * @param {string[]} idsArray - Array of display IDs
 * @returns {object} Summary object containing total, validCount, and invalidCount
 */
export function validateDisplayIdBatch(idsArray) {
  if (!Array.isArray(idsArray) || idsArray.length === 0) {
    return { total: 0, validCount: 0, invalidCount: 0, invalidIds: [] };
  }

  let validCount = 0;
  const invalidIds = [];

  for (const id of idsArray) {
    if (isValidOrderDisplayId(id)) {
      validCount++;
    } else {
      invalidIds.push(id);
    }
  }

  return {
    total: idsArray.length,
    validCount,
    invalidCount: invalidIds.length,
    invalidIds
  };
}


// === ENTERPRISE ESCROW REFERENCE PARSING (Issue #14101 Expansion) ===

/**
 * Parses and validates an escrow booking reference string.
 * 
 * @param {string} escrowRef - Escrow string (e.g., "escrow:#FF20260802K9X2Q7Z4M1A3")
 * @returns {object} Detailed parsing result containing validity, displayId, and embedded date
 */
export function parseAndValidateEscrowReference(escrowRef) {
  if (typeof escrowRef !== 'string' || !escrowRef.startsWith('escrow:')) {
    return { valid: false, displayId: null, orderDate: null, error: 'Invalid escrow reference format' };
  }

  const displayId = escrowRef.replace('escrow:', '');
  const parsedId = parseDisplayId(displayId);

  if (!parsedId.valid) {
    return { valid: false, displayId: null, orderDate: null, error: parsedId.error };
  }

  const orderDate = extractDateFromDisplayId(displayId);

  return {
    valid: true,
    displayId,
    orderDate,
    error: null
  };
}

// Update OrderDisplayIdManager object to include the new parser
OrderDisplayIdManager.parseAndValidateEscrowReference = parseAndValidateEscrowReference;
