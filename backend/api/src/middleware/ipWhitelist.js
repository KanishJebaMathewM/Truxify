import { AuditLogger } from '../services/auditLogger.js';

// IP Restriction Filter.
export const enforceIpWhitelist = (req, res, next) => {
  const allowedIps = req.apiKeyMetadata?.ipWhitelist;

  if (!allowedIps || allowedIps.length === 0) {
    return next();
  }

  const clientIp = req.ip || req.socket.remoteAddress;

  if (!allowedIps.includes(clientIp)) {
    AuditLogger.logFailure(req, `IP ${clientIp} not in whitelist`, 'ip_not_whitelisted');
    return res.status(403).json({ error: 'Forbidden: IP Address client restriction' });
  }

  next();
};