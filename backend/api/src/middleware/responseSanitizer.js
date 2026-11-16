/**
 * Response Sanitization Middleware
 *
 * Removes undefined values, internal fields, and sensitive metadata
 * from JSON responses before sending them to clients.
 */

const DEFAULT_PRIVATE_FIELDS = [
  "_internal",
  "__v",
  "_debug",
  "_metadata",
  "_private"
];

function sanitize(value) {
  // Database timestamps must retain Date's ISO-string/null JSON serialization.
  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    const cleaned = {};

    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      if (DEFAULT_PRIVATE_FIELDS.includes(key)) continue;
      // JSON can contain an own "__proto__" key. Assigning it to a normal
      // object mutates the prototype of the sanitized response instead of
      // creating a data property, which can expose inherited fields or
      // corrupt downstream serialization.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;

      cleaned[key] = sanitize(val);
    }

    return cleaned;
  }

  return value;
}

export default function responseSanitizer(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    return originalJson(sanitize(body));
  };

  next();
}
