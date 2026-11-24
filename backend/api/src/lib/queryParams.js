/**
 * Strict parsing for numeric query parameters.
 *
 * `parseFloat` accepts a numeric prefix and silently ignores trailing input:
 * `parseFloat('100abc')` is 100. Query filters built from that value look
 * valid to the caller but no longer describe what they asked for. `Number()`
 * rejects the suffix, but it also accepts hex literals, empty strings as zero,
 * and is not a grammar check on its own. This helper requires a decimal
 * numeric string and returns null for anything else so the route can answer
 * with a 400 instead of running a corrupted filter.
 */

const DECIMAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * @param {unknown} value raw query value
 * @param {{ min?: number, max?: number }} [bounds]
 * @returns {number|null} finite number inside the bounds, or null
 */
export function parseStrictNumber(value, bounds = {}) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) return null;

  const number = Number(trimmed);
  if (!Number.isFinite(number)) return null;

  if (bounds.min !== undefined && number < bounds.min) return null;
  if (bounds.max !== undefined && number > bounds.max) return null;

  return number;
}

export default parseStrictNumber;
