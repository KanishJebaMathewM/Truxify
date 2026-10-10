import { URL } from 'url';
import net from 'net';

// Define your permitted domains explicitly
const ALLOWED_DOMAINS = [
  'truxify.com',
  'api.truxify.com',
  // Add other trusted domains here
];

/**
 * Validates whether a given URL string is permitted, preventing SSRF attacks
 * via domain confusion, suffix spoofing, and loopback/private IP access.
 * 
 * @param {string} rawUrl - The URL string to validate
 * @returns {boolean} - Returns true if the URL is completely safe and allowed, false otherwise
 */
export function is_url_allowed(rawUrl) {
  try {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return false;
    }

    const parsedUrl = new URL(rawUrl);

    // 1. Enforce safe protocols (only http and https)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 2. Explicitly block localhost, IP addresses, and private/loopback ranges
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      net.isIP(hostname) !== 0 || // Blocks raw IPv4/IPv6 addresses
      isPrivateIp(hostname)
    ) {
      return false;
    }

    // 3. Strict hostname checking (preventing substring/domain confusion like 'truxify.com.evil.com')
    const isAllowed = ALLOWED_DOMAINS.some(domain => {
      const targetDomain = domain.toLowerCase();
      // Must be an exact match OR a proper subdomain ending with .domain (e.g., 'api.truxify.com')
      return hostname === targetDomain || hostname.endsWith(`.${targetDomain}`);
    });

    return isAllowed;
  } catch (err) {
    // If URL parsing throws an error (malformed URL), treat it as disallowed
    return false;
  }
}

/**
 * Helper function to detect private or reserved IP ranges if raw IPs are somehow evaluated.
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    // Check private IPv4 blocks (RFC 1918, loopback, link-local, etc.)
    const parts = ip.split('.').map(Number);
    if (
      parts[0] === 10 || 
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || 
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      parts[0] === 169 && parts[1] === 254
    ) {
      return true;
    }
  }
  return false;
}
