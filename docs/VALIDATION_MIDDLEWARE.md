# Validation Middleware

## Overview

The Truxify backend uses Zod-based validation middleware (`validate.js`) to validate request bodies, params, and query strings against named schemas before they reach route handlers.

---

## Location

Middleware:

```
backend/api/src/middleware/validate.js
```

Schemas:

```
backend/api/src/validation/requestSchemas.js
backend/api/src/validation/loadSchemas.js
```

---

## Helpers

| Helper | Validates | Behavior |
|--------|-----------|----------|
| `validateBody(schema)` | `req.body` | Replaces `req.body` with the parsed (coerced) data |
| `validateParams(schema)` | `req.params` | Replaces `req.params` with parsed data |
| `validateQuery(schema)` | `req.query` | Replaces `req.query` with parsed data |
| `validateArray(schema)` | `req.body` as an array | Validates each element |

On failure each helper returns `400` with a normalized error list:

```json
{
  "error": "Validation failed",
  "details": [{ "field": "body.phone", "message": "..." }]
}
```

---

## Usage

```js
router.post('/register', validateBody(registerUserSchema), handler);
router.get('/orders/:orderId', validateParams(orderIdSchema), handler);
```

---

## Why It Exists

Centralized schema validation:

- Keeps validation logic declarative and reviewable instead of scattered `if` checks.
- Coerces input (numbers, booleans) at the boundary.
- Guarantees that handlers only ever see validated, typed input.
- Produces consistent 400 responses for clients.

---

## Testing

Automated tests verify:

- Body/params/query validation success and failure paths.
- Array validation.
- Consistent error formatting.
