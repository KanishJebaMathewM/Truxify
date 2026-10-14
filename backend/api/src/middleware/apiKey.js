// Backward-compatible facade for the API key authentication stack.
// The middleware historically lived in this file; the modules it contained
// have been split into their canonical homes (config/authConfig.js,
// utils/cryptoUtils.js, services/keyRepository.js, services/metricsService.js,
// services/auditLogger.js, services/cacheService.js, services/keyRotationService.js,
// routes/adminKeysApi.js, middleware/apiKeyAuth.js, middleware/apiKeyRateLimiter.js,
// middleware/hmacAuth.js, middleware/rbac.js, middleware/ipWhitelist.js).
// Re-export everything to keep existing importers working unchanged.
export { requireApiKey } from './apiKeyAuth.js';
export { requireHmacSignature } from './hmacAuth.js';
export { requireScopes } from './rbac.js';
export { enforceIpWhitelist } from './ipWhitelist.js';
export { applyRateLimit } from './apiKeyRateLimiter.js';

export { authConfig, AuthConfig } from '../config/authConfig.js';
export { safeCompare, hashApiKey, generateSecureApiKey, calculateHmacSignature, maskSecret } from '../utils/cryptoUtils.js';
export { CacheService, keyCache } from '../services/cacheService.js';
export { metrics } from '../services/metricsService.js';
export { KeyRepository, keyRepo } from '../services/keyRepository.js';
export { AuditLogger } from '../services/auditLogger.js';
export { KeyRotationService, keyRotationService } from '../services/keyRotationService.js';
export { createAdminApiRouter } from '../routes/adminKeysApi.js';
