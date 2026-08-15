/**
 * Order display ID format validation utilities.
 *
 * @module orderDisplayIdValidation
 */

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
 * Validates that the date portion is a real calendar date (not just 8 digits).
 * @param {string} displayId - Valid display ID
 * @returns {string|null} YYYYMMDD date string or null
 */
export function getDisplayIdDate(displayId) {
  if (!isValidDisplayId(displayId)) return null;
  const dateStr = displayId.slice(3, 11);
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6));
  const day = Number(dateStr.slice(6, 8));

  // Reject out-of-range values that pass the regex but are not valid dates
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Validate using Date constructor: invalid dates produce "Invalid Date"
  const parsed = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  // Reject pre-2020 and post-2100 dates as clearly invalid
  if (year < 2020 || year > 2100) return null;

  return dateStr;
}
