/**
 * Normalizes a phone number to E.164 format (e.g. +919876543210 or +12025550123).
 * Returns null if the number cannot be parsed.
 *
 * Handles formats:
 *   +91 9876543210
 *   0919876543210
 *   9876543210
 *   919876543210
 *   +1 202 555 0123 (international E.164)
 *
 * @param {string} phone - Raw phone input.
 * @param {string} [defaultCountryCode='91'] - Default country calling code without '+'
 * @returns {string|null} E.164 normalized phone, or null if invalid.
 */
export function normalizePhone(phone, defaultCountryCode = '91') {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, '');

  // Handle explicit international prefix (+) for non-91 or standard E.164 numbers
  if (trimmed.startsWith('+')) {
    if (digits.length >= 7 && digits.length <= 15) {
      if (digits.startsWith('91')) {
        // India specific 10-digit validation
        if (digits.length === 12) {
          return `+${digits}`;
        }
        return null;
      }
      return `+${digits}`;
    }
    return null;
  }

  let localDigits = digits;

  // Strip a leading trunk prefix 0 only for the country-code form
  // (e.g. 0919876543210 -> 919876543210). A bare 0-prefixed local number is
  // not a valid trunk form and is left alone so it fails the 10-digit
  // validation below instead of being silently corrupted.
  if (localDigits.startsWith('0') && localDigits.length === 13) {
    localDigits = localDigits.slice(1);
  }

  // Remove country code prefix if present (91 for India)
  const cc = defaultCountryCode.replace(/[^\d]/g, '') || '91';
  if (localDigits.startsWith(cc) && localDigits.length === cc.length + 10) {
    localDigits = localDigits.slice(cc.length);
  } else if (localDigits.startsWith('0')) {
    // Strip a leading trunk prefix 0 (e.g. 09876543210 -> 9876543210)
    localDigits = localDigits.slice(1);
  }

  // Strip a leading trunk prefix 0 only from remaining 11-digit sequences
  if (localDigits.startsWith('0') && localDigits.length === 11) {
    localDigits = localDigits.slice(1);
  }

  // Validate: must be exactly 10 digits after country code removal
  if (localDigits.length !== 10) {
    return null;
  }

  // Validate all characters are digits
  if (!/^\d{10}$/.test(localDigits)) {
    return null;
  }

  // Return in E.164 format with country code
  return `+${cc}${localDigits}`;
}
