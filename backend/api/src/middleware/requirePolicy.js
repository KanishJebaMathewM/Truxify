import { policy, PolicyError } from '../security/policyEngine.js';

/**
 * Middleware to enforce policy-based authorization.
 *
 * @param {string} action - The policy action to check.
 * @param {function} [getResource] - Optional async function that resolves the
 *   resource from req. Called as `getResource(req)` and its return value is
 *   passed to the ownership check. When omitted, the ownership check is
 *   skipped (backward-compatible with existing call sites).
 */
export function requirePolicy(action, getResource) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated: req.user is missing.' });
    }
    try {
      if (getResource) {
        Promise.resolve(getResource(req)).then((resource) => {
          try {
            policy.authorize(req.user, action, resource);
            next();
          } catch (err) {
            if (err instanceof PolicyError) {
              return res.status(err.status).json({ error: err.message });
            }
            return res.status(500).json({ error: 'Internal Server Error' });
          }
        }).catch((err) => {
          if (err instanceof PolicyError) {
            return res.status(err.status).json({ error: err.message });
          }
          return res.status(500).json({ error: 'Internal Server Error' });
        });
      } else {
        policy.authorize(req.user, action);
        next();
      }
    } catch (err) {
      if (err instanceof PolicyError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
