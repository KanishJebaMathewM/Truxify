/**
 * Order display ID format validation utilities.
 *
 * @module orderDisplayIdValidation
 */

import { DISPLAY_ID_PREFIX, DISPLAY_ID_RANDOM_LENGTH } from '../lib/orderDisplayId.js';

const DISPLAY_ID_PATTERN = /^#FF\d{8}[A-Z0-9]{12}$/;

/**
 * Validate that a display ID matches the expected format.
 * @param {string} displayId - The display ID to validate
 * @returns {boolean}
 */
export function isValidDisplayId(displayId) {
  if (typeof displayId !== 'string') return false;
  return DISPLAY_ID_PATTERN.test(displayId);
}

/**
 * Get the date portion of a display ID.
 * @param {string} displayId - Valid display ID
 * @returns {string|null} YYYYMMDD date string or null
 */
export function getDisplayIdDate(displayId) {
  if (!isValidDisplayId(displayId)) return null;
  return displayId.slice(3, 11);
}
