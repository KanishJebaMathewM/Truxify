# Response Sanitizer Middleware

## Overview

The Truxify backend includes a response sanitizer middleware that removes internal fields, undefined values, and private metadata from JSON responses before they are sent to clients.

---

## Location

Middleware:

```
backend/api/src/middleware/responseSanitizer.js
```

---

## Behavior

When a route calls `res.json(body)`, the middleware recursively:

- Removes entries whose value is `undefined`.
- Removes entries whose key is in the private-field blocklist.
- Recurses into nested objects and arrays.

Default private fields removed:

```
_internal
__v
_debug
_metadata
_private
```

---

## Why It Exists

Database documents (especially Mongoose documents) can carry internal bookkeeping fields such as `__v` (version key) or debug metadata. Leaking these to clients:

- Exposes implementation details useful to attackers.
- Bloats API payloads.
- Risks accidentally leaking private annotations.

The sanitizer keeps the wire format clean without requiring every route to whitelist fields manually.

---

## Extending

The blocklist is defined as `DEFAULT_PRIVATE_FIELDS` at the top of the file. Add internal field names there to strip them from all responses.

---

## Testing

Automated tests verify:

- Undefined values are removed.
- Private blocklist fields are removed at any nesting depth.
- Arrays are sanitized recursively.
- Non-object values pass through unchanged.
