/**
 * Cursor-based pagination utilities for efficient large dataset pagination.
 *
 * @module cursorPagination
 */

import { Buffer } from 'buffer';
import logger from '../middleware/logger.js';

/**
 * Encode opaque cursor data into a URL-safe base64 string.
 * @param {object} data - Cursor data to encode (e.g., { id, createdAt })
 * @returns {string} URL-safe base64 encoded cursor
 */
export function encodeCursor(data) {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString('base64url');
}

/**
 * Decode a cursor string back to its original data object.
 * @param {string} cursor - The cursor string to decode
 * @returns {object|null} Decoded cursor data, or null if invalid
 */
export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    logger.warn('[cursorPagination] Failed to decode cursor:', err?.message);
    return null;
  }
}

/**
 * Check if a cursor is valid and not tampered with.
 * @param {string} cursor - The cursor to validate
 * @returns {boolean}
 */
export function isValidCursor(cursor) {
  return decodeCursor(cursor) !== null;
}
