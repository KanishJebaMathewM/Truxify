/**
 * @fileoverview WASI runtime helpers and SSRF guard utilities.
 */

/**
 * Validates whether a URL is permitted for egress from the WASI sandbox.
 * Prevents SSRF attacks, domain confusion, loopback/private range bypasses, and protocol spoofing.
 *
 * @param {string} urlStr - The URL string to validate.
 * @param {string[]} [allowedDomains=['truxify.com']] - List of permitted base domains.
 * @returns {boolean} True if the URL is strictly permitted.
 */
export function is_url_allowed(urlStr, allowedDomains = ['truxify.com']) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject IPv4, IPv6, localhost
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[') || hostname === 'localhost') {
    return false;
  }

  return allowedDomains.some((domain) => {
    const lowerDomain = domain.toLowerCase();
    return hostname === lowerDomain || hostname.endsWith('.' + lowerDomain);
  });
}

export default {
  is_url_allowed,
};
