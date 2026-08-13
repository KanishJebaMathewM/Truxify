import logger from './logger.js';

const SQLI_PATTERNS = [
  /union\s+select/i,
  /drop\s+table/i,
  /insert\s+into/i,
  /delete\s+from/i,
  /or\s+1=1/i,
  // Note: standalone "--" SQL comment patterns removed to avoid false positives
  // (markdown YAML headers, date ranges like 2026-01-01--2026-02-01, negative numbers).
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
  const rawUa = req.headers["user-agent"];
  // A repeated user-agent header arrives as an array; take the first value
  // and clamp the length so a hostile agent string cannot inject log lines.
  const ua = (Array.isArray(rawUa) ? rawUa[0] : rawUa) || "";
  const uaForLog = typeof ua === "string" ? ua.slice(0, 256) : String(ua).slice(0, 256);

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
    req.suspicious = true;
    req.threatFindings = findings;

    logger.warn({
      requestId: req.requestId,
      ip: req.ip,
      method: req.method,
      path: req.originalUrl,
      findings,
      userAgent: uaForLog,
    }, "Suspicious request detected");

    const blocking = findings.filter(f =>
      ['Path Traversal'].includes(f)
    );
    if (blocking.length) {
      return res.status(403).json({ error: 'Request blocked: suspicious content detected' });
    }
  }

  next();
}

// === Spec 6: ===
// === Spec 6: prevent prototype pollution ===
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
export function sanitizeKey(k) {
  if (typeof k !== 'string') return null;
  if (FORBIDDEN.has(k)) return null;
  if (k.startsWith('__') || k.includes('..')) return null;
  return k;
}
export function sanitizeQueryParams(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const safe = sanitizeKey(k);
    if (safe !== null) out[safe] = v;
  }
  return out;
}

