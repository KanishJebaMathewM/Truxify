# Error Handler Middleware

## Overview

The Truxify backend centralizes HTTP error responses in a single Express error-handling middleware. It maps common error types to correct status codes and consistent response shapes, and never leaks internal stack traces to clients.

---

## Location

Middleware:

```
backend/api/src/middleware/errorHandler.js
```

---

## Error Mapping

| Error | Status | Response |
|-------|--------|----------|
| Payload too large (`entity.too.large`) | 413 | `{ success: false, error: "Payload too large" }` |
| Malformed JSON body | 400 | `{ success: false, error: "Malformed JSON payload" }` |
| Multer upload error | 413 (file size) / 400 | `{ success: false, error, code }` |
| Zod validation error | 400 | `{ success: false, error: "Validation failed", details }` |
| AppError (typed domain error) | `err.statusCode` | `{ success: false, error }` |
| Everything else | 500 | `{ success: false, error: "Critical Internal Server Error." }` |

Unknown errors are logged with the request ID (and error details) on the server, but the client only receives the generic message — no stack traces, file paths, or internal variable names.

---

## Why It Exists

A single error boundary guarantees:

- Consistent response shapes across every route.
- Correct status codes for common failure classes.
- No internal detail leakage in production.
- Structured server-side logging with request correlation.

---

## Testing

Automated tests verify:

- Payload-too-large responses.
- Malformed JSON handling.
- Multer error mapping.
- Zod error formatting.
- AppError status passthrough.
- Unknown errors return a generic 500.
