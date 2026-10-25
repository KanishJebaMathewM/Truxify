import logger from '../middleware/logger.js';
import { mlMatchingGateway } from './mlMatchingGateway.js';
import { validatePricePrediction, convertToPaisa } from '../lib/predictionValidator.js';
import { LRUCache } from '../utils/cache.js';

const demandCache = new LRUCache(100, 15 * 60 * 1000);
const priceCache = new LRUCache(100, 15 * 60 * 1000);

const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';
const ML_HTTP_TIMEOUT_MS = 5000;
const ML_DEFAULT_PICKUP_LEAD_MS = 8 * 60 * 60 * 1000;
const DEFAULT_TRUCK_MAX_WEIGHT_KG = 25000;
const DEFAULT_TRUCK_MAX_LENGTH_M = 12;
const DEFAULT_TRUCK_MAX_WIDTH_M = 2.5;
const DEFAULT_TRUCK_MAX_HEIGHT_M = 4;

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

// Startup validation warning
const initialApiKey = (process.env.ML_API_KEY || '').trim();
if (!initialApiKey) {
  logger.warn('[ML] WARNING: ML_API_KEY is not set. All ML API endpoints will return 503. Set ML_API_KEY in your environment.');
}

function guardMlApiKey() {
  const apiKey = (process.env.ML_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('[ML] ML_API_KEY is not configured. All ML endpoints will return 503. Set ML_API_KEY to enable ML features.');
  }
}

function getBaseUrl() {
  return process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || DEFAULT_ML_ENGINE_URL;
}

function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  const apiKey = (process.env.ML_API_KEY || '').trim();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

async function handleResponse(response, url = '', method = 'GET') {
  const text = await response.text();

  if (response.status === 401 || response.status === 403) {
    logger.error({ status: response.status, url, method }, `[ML] Authentication failed (${response.status}) for ${method} ${url}`);
    throw new Error(`[ML] Authentication failed (${response.status})`);
  }
  if (!response.ok) {
    logger.error({ status: response.status, url, method, text }, `[ML] Request failed for ${method} ${url}`);
    throw new Error(`[ML] Request failed (${response.status})`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    logger.error({ status: response.status, url }, `ML service request failed [${method}] ${url}`);
    throw new Error(`[ML] Invalid JSON response from ML engine: ${err?.message ?? String(err)}`, { cause: err });
  }
}

/**
 * Parse the free-text `weight` column of load_offers (e.g. '3 tonnes') into kilograms.
 */
export function parseWeightKg(weight) {
  if (weight == null || typeof weight === 'boolean' || Array.isArray(weight)) {
    return null;
  }
  if (typeof weight === 'number') {
    return Number.isFinite(weight) ? weight : null;
  }
  if (typeof weight !== 'string') {
    return null;
  }
  const trimmed = weight.trim();
  if (!trimmed) return null;

  const match = trimmed.toLowerCase().match(/([\d.]+)\s*(kg|tons?|tonnes?|t)\b/);
  if (!match) {
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === 'kg' ? value : value * 1000;
}

export function parseWeightKgSafe(weightInput, defaultKg = 1000) {
