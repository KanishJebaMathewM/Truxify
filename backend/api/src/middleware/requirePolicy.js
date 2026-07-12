import { policy, PolicyError } from '../security/policyEngine.js';

export function requirePolicy(action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated: req.user is missing.' });
    }
    try {
      policy.authorize(req.user, action);
      next();
    } catch (err) {
      if (err instanceof PolicyError) {
        return res.status(err.status).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
