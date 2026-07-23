import logger from '../middleware/logger.js';

const DEFAULT_MAX_RETRIES = parseInt(process.env.SUPABASE_RETRY_MAX_RETRIES || '3', 10);
const DEFAULT_BASE_DELAY_MS = parseInt(process.env.SUPABASE_RETRY_BASE_DELAY_MS || '100', 10);
const DEFAULT_MAX_DELAY_MS = parseInt(process.env.SUPABASE_RETRY_MAX_DELAY_MS || '2000', 10);

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EPIPE',
  'ERR_NETWORK',
  'FETCH_ERR',
]);

function isTransientHttpStatus(status) {
  if (status == null) return false;
  if (status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 429 || status === 408) return true;
  return false;
}

function isTransientError(error) {
  if (!error) return false;

  if (error.code && NETWORK_ERROR_CODES.has(error.code)) return true;

  if (error.status != null && isTransientHttpStatus(Number(error.status))) return true;

  if (error.message) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network timeout') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed') || msg.includes('socket hang up') || msg.includes('unexpected network')) {
      return true;
    }
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;

  return false;
}

function isNonRetryableSupabaseError(error) {
  if (!error) return false;

  if (error.code === '23505') return true; // duplicate key
  if (error.code === 'PGRST116') return true; // no rows returned
  if (error.code === 'PGRST204') return true; // no columns returned
  if (error.code === '42501') return true; // permission denied
  if (error.code?.startsWith('PGRST')) return true; // postgrest errors (deterministic)

  if (error.status != null) {
    const s = Number(error.status);
    if (s >= 200 && s < 500 && s !== 429 && s !== 408) return true;
  }

  return false;
}

export function isRetryable(error) {
  if (isNonRetryableSupabaseError(error)) return false;
  return isTransientError(error);
}

export async function executeWithRetry(asyncFn, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const operation = options.operation || 'supabase_query';

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt >= maxRetries) {
        if (attempt > 0) {
          logger.warn({ err, operation, attempt, maxRetries }, `[retry] Non-retryable error or max retries reached for ${operation}`);
        }
        throw err;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      logger.warn({ err, operation, attempt: attempt + 1, maxRetries, delayMs: delay }, `[retry] Transient error in ${operation}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
