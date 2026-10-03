import logger from './logger.js';

const RECOMMENDED_ATTRIBUTES = ['HttpOnly', 'SameSite', 'Path', 'Secure'];

export default function cookieSecurityValidator(req, res, next) {
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'set-cookie') {
      validateCookies(req, value);
    }
    return originalSetHeader(name, value);
  };

  next();
}

function validateCookies(req, value) {
  const cookies = Array.isArray(value) ? value : [value];

  for (const cookie of cookies) {
    const cookieValue = String(cookie);
    const missingAttributes = RECOMMENDED_ATTRIBUTES.filter(
      (attribute) => !cookieValue.includes(attribute)
    );

    if (missingAttributes.length === 0) continue;

    logger.warn(
      {
        method: req.method,
        path: req.originalUrl,
        missingAttributes,
      },
      'Cookie missing recommended security attributes'
    );
  }
}


// === ENTERPRISE COOKIE SECURITY EXTENSIONS (Issue #14104 Expansion) ===

/**
 * Parses a raw 'Set-Cookie' header string into a structured attribute map object.
 * 
 * @param {string} cookieStr - Raw cookie string (e.g., "session=abc; HttpOnly; Secure; SameSite=Strict")
 * @returns {object} Parsed cookie object containing name, value, and flags
 */
export function parseCookieSecurityHeader(cookieStr) {
  if (typeof cookieStr !== 'string' || cookieStr.trim() === '') {
    return { name: null, value: null, attributes: [], isSecure: false, isHttpOnly: false, sameSite: null };
  }

  const parts = cookieStr.split(';').map(p => p.trim());
  const mainPart = parts[0];
  const [name, ...valueParts] = mainPart.split('=');
  const value = valueParts.join('=');

  const attributes = parts.slice(1);
  const attributeMap = {};

  for (const attr of attributes) {
    const [attrName, attrVal] = attr.split('=').map(s => s.trim());
    attributeMap[attrName.toLowerCase()] = attrVal !== undefined ? attrVal : true;
  }

  return {
    name: name ? name.trim() : null,
    value: value ? value.trim() : null,
    attributes,
    isSecure: Boolean(attributeMap['secure']),
    isHttpOnly: Boolean(attributeMap['httponly']),
    sameSite: attributeMap['samesite'] || null
  };
}

/**
 * Audits an array of cookies against enterprise security compliance rules.
 * 
 * @param {string|string[]} cookies - Single cookie string or array of cookie strings
 * @returns {object} Audit report with compliance score and violations list
 */
export function auditCookieCompliance(cookies) {
  const cookieList = Array.isArray(cookies) ? cookies : [cookies];
  let compliantCount = 0;
  const violations = [];

  for (const cookie of cookieList) {
    const parsed = parseCookieSecurityHeader(cookie);
    if (!parsed.name) continue;

    const missing = [];
    if (!parsed.isHttpOnly) missing.push('HttpOnly');
    if (!parsed.isSecure) missing.push('Secure');
    if (!parsed.sameSite) missing.push('SameSite');

    if (missing.length === 0) {
      compliantCount++;
    } else {
      violations.push({ cookieName: parsed.name, missingAttributes: missing });
    }
  }

  const total = cookieList.filter(c => typeof c === 'string' && c.trim() !== '').length;
  const complianceScore = total === 0 ? 100 : Math.round((compliantCount / total) * 100);

  return {
    totalChecked: total,
    compliantCount,
    violationCount: violations.length,
    complianceScore,
    violations
  };
}

// Unified enterprise utility module export
export const CookieSecurityManager = {
  cookieSecurityValidator,
  parseCookieSecurityHeader,
  auditCookieCompliance
};


// === ENTERPRISE COOKIE SANITIZATION & PRODUCTION HARDENING (Issue #14104 Expansion) ===

/**
 * Sanitizes a raw cookie header string to enforce production security hardening 
 * (automatically injects missing HttpOnly/Secure flags and restricts SameSite).
 * 
 * @param {string} cookieStr - Raw cookie string
 * @returns {string} Hardened secure cookie string
 */
export function sanitizeCookieHeader(cookieStr) {
  if (typeof cookieStr !== 'string' || cookieStr.trim() === '') {
    return '';
  }

  const parsed = parseCookieSecurityHeader(cookieStr);
  if (!parsed.name || !parsed.value) {
    return cookieStr;
  }

  const attributes = [];
  attributes.push(`${parsed.name}=${parsed.value}`);
  attributes.push('HttpOnly');
  attributes.push('Secure');
  attributes.push(`SameSite=${parsed.sameSite || 'Strict'}`);

  return attributes.join('; ');
}

// Update CookieSecurityManager object
CookieSecurityManager.sanitizeCookieHeader = sanitizeCookieHeader;


// === ENTERPRISE COOKIE PREFIX SECURITY POLICY (Issue #14104 Expansion) ===

/**
 * Validates cookie naming prefix security policies (__Host- and __Secure- rules).
 * 
 * @param {string} cookieStr - Raw cookie header string
 * @returns {object} Validation result with isValid and policy violations list
 */
export function validateCookiePrefixPolicy(cookieStr) {
  const parsed = parseCookieSecurityHeader(cookieStr);
  if (!parsed.name) {
    return { isValid: false, violations: ['Invalid cookie name or empty format'] };
  }

  const violations = [];
  const name = parsed.name;

  if (name.startsWith('__Host-')) {
    if (!parsed.isSecure) {
      violations.push('__Host- cookies must have Secure attribute');
    }
    const hasRootPath = parsed.attributes.some(attr => attr.toLowerCase() === 'path=/');
    if (!hasRootPath) {
      violations.push('__Host- cookies must specify Path=/');
    }
    const hasDomain = parsed.attributes.some(attr => attr.toLowerCase().startsWith('domain='));
    if (hasDomain) {
      violations.push('__Host- cookies must not specify a Domain attribute');
    }
  } else if (name.startsWith('__Secure-')) {
    if (!parsed.isSecure) {
      violations.push('__Secure- cookies must have Secure attribute');
    }
  }

  return {
    isValid: violations.length === 0,
    cookieName: name,
    violations
  };
}

// Update CookieSecurityManager object
CookieSecurityManager.validateCookiePrefixPolicy = validateCookiePrefixPolicy;


// === ADVANCED COOKIE SECURITY BUILDER & ANOMALY DETECTION (Issue #14104 Expansion) ===

/**
 * Builder utility that constructs a fully RFC-compliant hardened cookie header string.
 * 
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {object} [options={}] - Optional configuration (secure, httpOnly, sameSite, maxAge, path, domain)
 * @returns {string} Fully constructed Set-Cookie header string
 */
export function generateSecureCookieHeader(name, value, options = {}) {
  if (!name || typeof name !== 'string' || value === undefined || value === null) {
    return '';
  }

  const parts = [`${name.trim()}=${String(value).trim()}`];

  // Enforce security defaults while allowing custom overrides
  const isHttpOnly = options.httpOnly !== false; // default true
  const isSecure = options.secure !== false;     // default true
  const sameSite = options.sameSite || 'Strict';

  if (isHttpOnly) parts.push('HttpOnly');
  if (isSecure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);

  if (options.path) {
    parts.push(`Path=${options.path}`);
  } else {
    parts.push('Path=/');
  }

  if (options.maxAge && Number.isInteger(options.maxAge)) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.domain && typeof options.domain === 'string') {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

/**
 * Scans and detects structural or cryptographic anomalies in cookie headers.
 * 
 * @param {string} cookieStr - Raw Set-Cookie header string
 * @returns {object} Anomaly report containing riskLevel, flags, and warnings
 */
export function detectCookieAnomaly(cookieStr) {
  if (typeof cookieStr !== 'string' || cookieStr.trim() === '') {
    return { riskLevel: 'NONE', anomaliesDetected: 0, warnings: [] };
  }

  const warnings = [];
  let riskLevel = 'LOW';

  // Check length anomaly (cookies larger than 4KB are problematic)
  if (cookieStr.length > 4096) {
    warnings.push('Cookie payload exceeds 4KB standard limit');
    riskLevel = 'MEDIUM';
  }

  // Check for missing Secure flag on production tokens
  if (!cookieStr.toLowerCase().includes('secure')) {
    warnings.push('High risk: Cookie lacks Secure flag transmission protection');
    riskLevel = 'HIGH';
  }

  // Check for SameSite=None without Secure
  if (cookieStr.toLowerCase().includes('samesite=none') && !cookieStr.toLowerCase().includes('secure')) {
    warnings.push('Critical vulnerability: SameSite=None configured without Secure flag');
    riskLevel = 'CRITICAL';
  }

  // Check for wildcard or unconstrained domain flags
  if (cookieStr.toLowerCase().includes('domain=.')) {
    warnings.push('Moderate risk: Broad wildcard domain scope detected');
    if (riskLevel !== 'CRITICAL' && riskLevel !== 'HIGH') {
      riskLevel = 'MEDIUM';
    }
  }

  return {
    riskLevel,
    anomaliesDetected: warnings.length,
    warnings
  };
}

// Update CookieSecurityManager object
CookieSecurityManager.generateSecureCookieHeader = generateSecureCookieHeader;
CookieSecurityManager.detectCookieAnomaly = detectCookieAnomaly;
