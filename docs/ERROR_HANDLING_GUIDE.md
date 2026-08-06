# Error Handling Guide

This document describes the error handling conventions used in the Truxify backend API.

## Error Types

### DomainError

**Location:** `backend/api/src/errors/DomainError.js`

`DomainError` is the primary error class for application-level errors. It carries an HTTP status code and a structured payload.

```javascript
import { DomainError } from '../errors/DomainError.js';

throw new DomainError('Driver not assigned to this order', 403, {
  code: 'DRIVER_NOT_ASSIGNED',
  orderId: req.params.id,
});
```

**Constructor signature:**
```javascript
new DomainError(message, status, payload?)
```

- `message` — Human-readable error description
- `status` — HTTP status code (400, 401, 403, 404, 409, 422, 500, etc.)
- `payload` — Optional structured data included in the JSON response

### Standard Error Codes Used in This Codebase

| Status | Use Case |
|--------|----------|
| 400 | Bad Request — malformed input, missing required fields |
| 401 | Unauthorized — missing or invalid authentication |
| 403 | Forbidden — authenticated but not authorized for this resource |
| 404 | Not Found — resource does not exist |
| 409 | Conflict — state conflict (e.g., duplicate resource) |
| 422 | Unprocessable Entity — semantically invalid input |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error — unexpected server-side failure |
| 502 | Bad Gateway — external service failure |
| 503 | Service Unavailable — service is temporarily down |

### When to Use DomainError vs Plain Error

- **Use `DomainError`** for application-level errors that should result in a structured HTTP response (validation failures, not found, forbidden, conflict).
- **Use `Error`** for unexpected programming errors that indicate a bug in the code.

```javascript
// Good: DomainError for expected application error
if (!order) {
  throw new DomainError('Order not found', 404, { orderId });
}

// Avoid: Throwing plain Error for application errors
if (!order) {
  throw new Error('Order not found'); // No structured payload, unclear status
}
```

## Error Handler Middleware

**Location:** `backend/api/src/middleware/errorHandler.js`

All errors thrown in route handlers are caught by the global error handler middleware.

```javascript
// The error handler middleware catches DomainError and plain Error
// DomainError → returns res.status(domainError.status).json(domainError.payload)
// Error → returns res.status(500).json({ error: 'Internal Server Error' })
```

**In development mode**, plain errors include the stack trace in the response for easier debugging.

**In production mode**, plain errors return a generic message to avoid leaking implementation details.

## Creating Custom DomainError Subclasses

For related errors that share a status code, create a subclass:

```javascript
// backend/api/src/errors/ValidationError.js
import { DomainError } from './DomainError.js';

export class ValidationError extends DomainError {
  constructor(message, details = {}) {
    super(message, 422, { code: 'VALIDATION_ERROR', ...details });
  }
}

// Usage
if (!email) {
  throw new ValidationError('Email is required', { field: 'email' });
}
```

## Error Response Format

All error responses follow a consistent JSON format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",        // Optional: structured error code
  "field": "field_name",       // Optional: for validation errors
  "details": []                 // Optional: for complex validation errors
}
```

## Logging Errors

Errors should be logged at the appropriate level:

- **`logger.error`** — Unexpected errors (bugs, external service failures)
- **`logger.warn`** — Expected violations (authentication failures, rate limit hits, not found)

```javascript
// Log unexpected errors with context
logger.error({ err, orderId, userId }, 'Failed to process delivery confirmation');

// Log expected failures as warnings
logger.warn({ userId, orderId }, 'Customer attempted to confirm delivery without OTP');
```

## Async Error Handling

All async route handlers must use `try/catch` to handle errors. The Express error handler middleware only catches errors that are passed to `next(err)`.

```javascript
// Correct: try/catch in async handler
router.post('/api/action', async (req, res, next) => {
  try {
    const result = await someAsyncOperation();
    res.json(result);
  } catch (err) {
    // Pass to error handler
    next(err);
  }
});

// Correct: wrap with express-async-errors or use a wrapper
// (if the project adopts express-async-errors, try/catch becomes optional)
```

## Database Error Handling

Supabase/Postgres errors should be caught and converted to DomainError:

```javascript
try {
  const { data, error } = await supabase.from('orders').select('*');
  if (error) throw error;
} catch (err) {
  if (err.code === 'PGRST301') {
    throw new DomainError('Invalid filter operator', 400, { originalError: err.message });
  }
  throw new DomainError('Database error', 500, { originalError: err.message });
}
```

## Common Patterns

### Validation Errors

```javascript
if (!req.body.amount || req.body.amount <= 0) {
  throw new DomainError('Amount must be a positive number', 400, {
    code: 'INVALID_AMOUNT',
    field: 'amount',
  });
}
```

### Not Found Errors

```javascript
const order = await orderRepository.findById(req.params.id);
if (!order) {
  throw new DomainError('Order not found', 404, { orderId: req.params.id });
}
```

### Authorization Errors

```javascript
if (order.customer_id !== req.user.id) {
  throw new DomainError('You do not have access to this order', 403, {
    code: 'ORDER_ACCESS_DENIED',
  });
}
```

## Testing Error Handling

When writing unit tests for functions that throw errors, use Vitest's `toThrow`:

```javascript
import { expect, it } from 'vitest';

it('throws DomainError when order is not found', async () => {
  vi.mock('../../src/config/db.js', () => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }) }
  }));

  await expect(findOrder('missing-id')).rejects.toThrow(DomainError);
});
```

## Sentry Integration

Unexpected errors are automatically reported to Sentry via the `sentryErrorHandler` middleware. The `beforeSend` hook filters out non-actionable network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT).

```javascript
// backend/api/src/middleware/sentry.js
const SENTRY_ERROR_FILTERS = [
  { code: 'ECONNRESET', level: 'warn' },
  { code: 'ECONNREFUSED', level: 'warn' },
  { code: 'ETIMEDOUT', level: 'warn' },
];
```

To add a user context to Sentry errors:

```javascript
Sentry.setUser({
  id: req.user.id,
  role: req.user.role,
  email: req.user.email,
});
```
