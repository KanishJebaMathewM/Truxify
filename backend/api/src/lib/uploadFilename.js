/**
 * Filename sanitisation for uploaded files.
 *
 * `file.originalname` is entirely client-controlled. It reaches log lines,
 * storage keys and downstream service calls, so it is normalised here before
 * it is used anywhere. Shared by the document, maintenance-photo and voice
 * upload paths so the rules cannot drift between them.
 */

/** Maximum length of a sanitised filename, extension included. */
const MAX_FILENAME_LENGTH = 120;

/** Windows reserved device names, rejected regardless of extension. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Strip any directory component from a client-supplied name.
 *
 * Handles both separators explicitly rather than using path.basename, which
 * only recognises the separator of the host platform — a POSIX server would
 * otherwise pass `..\\..\\etc\\passwd` through untouched.
 *
 * @param {string} name
 * @returns {string}
 */
function stripDirectories(name) {
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return lastSeparator === -1 ? name : name.slice(lastSeparator + 1);
}

/**
 * Normalise a client-supplied filename into something safe to log and store.
 *
 * Guarantees the result contains no path separators, no traversal sequences,
 * no control characters, no NUL bytes, and is never empty.
 *
 * @param {unknown} originalName Raw `file.originalname` from multer.
 * @param {string} fallback Name to use when nothing usable survives.
 * @returns {string}
 */
export function sanitizeUploadFilename(originalName, fallback = 'upload') {
  if (typeof originalName !== 'string' || originalName.length === 0) {
    return fallback;
  }

  let name = stripDirectories(originalName);

  // Drop control characters and NUL bytes, which can truncate or corrupt
  // downstream log lines and filesystem calls.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f]/g, '');

  // Collapse anything outside a conservative allowlist to underscores. This
  // neutralises traversal sequences, shell metacharacters and unicode
  // lookalikes in one pass rather than blocklisting them individually.
  name = name.replace(/[^A-Za-z0-9._-]/g, '_');

  // Leading dots would produce a hidden file, and repeated dots can still
  // read as a traversal segment to a naive consumer.
  name = name.replace(/\.{2,}/g, '.').replace(/^\.+/, '');

  if (name.length > MAX_FILENAME_LENGTH) {
    const lastDot = name.lastIndexOf('.');
    const extension = lastDot > 0 ? name.slice(lastDot, lastDot + 12) : '';
    name = name.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
  }

  const stem = (name.split('.')[0] || '').toLowerCase();
  if (name.length === 0 || RESERVED_NAMES.has(stem)) {
    return fallback;
  }

  return name;
}
