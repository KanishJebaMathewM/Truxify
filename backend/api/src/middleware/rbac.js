import { metrics } from '../services/metricsService.js';
import { AuditLogger } from '../services/auditLogger.js';

// Role & Scope Verification Middleware.
export const requireScopes = (...requiredScopes) => {
  return (req, res, next) => {
    const keyScopes = req.apiKeyMetadata?.scopes || [];

    // Wildcard access allowed
    if (keyScopes.includes('*')) {
      return next();
    }

    const hasPermission = requiredScopes.every((scope) => keyScopes.includes(scope));

    if (!hasPermission) {
      metrics.increment('scopeUnauthorized');
      AuditLogger.logFailure(req, `Insufficient scopes. Required: ${requiredScopes.join(', ')}`, 'forbidden_scope');

      return res.status(403).json({
        error: 'Forbidden',
        message: `Your API key lacks the required scopes: [${requiredScopes.join(', ')}]`,
      });
    }

    next();
  };
};
