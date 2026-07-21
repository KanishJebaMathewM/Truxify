import logger from './logger.js';

const SQLI_PATTERNS = [
  /union\s+select/i,
  /drop\s+table/i,
  /insert\s+into/i,
  /or\s+1=1/i,
  /--/,
];

const XSS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /onerror=/i,
  /onload=/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e/i,
];

const SUSPICIOUS_UA = [
  /sqlmap/i,
  /nikto/i,
  /curl/i,
  /wget/i,
];

function matches(patterns, value) {
  return patterns.some((pattern) => pattern.test(value));
}

export default function suspiciousRequests(req, res, next) {
  const body = JSON.stringify(req.body || {});
  const query = JSON.stringify(req.query || {});
  const url = req.originalUrl || "";
  const ua = req.headers["user-agent"] || "";

  const findings = [];

  if (matches(SQLI_PATTERNS, body) || matches(SQLI_PATTERNS, query))
    findings.push("SQL Injection");

  if (matches(XSS_PATTERNS, body) || matches(XSS_PATTERNS, query))
    findings.push("Cross-Site Scripting");

  if (matches(PATH_TRAVERSAL_PATTERNS, url))
    findings.push("Path Traversal");

  if (matches(SUSPICIOUS_UA, ua))
    findings.push("Suspicious User Agent");

  if (findings.length) {
    logger.warn({
      requestId: req.requestId,
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      findings,
      userAgent: ua,
    }, "Suspicious request detected");
  }

  next();
}