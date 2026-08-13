# API Response Helpers

## Overview

The Truxify backend uses standard response helpers (`lib/apiResponse.js`) so every endpoint returns a consistent JSON envelope. This keeps client parsing simple and predictable.

---

## Location

```
backend/api/src/lib/apiResponse.js
```

---

## Helpers

### success(data, message, statusCode)

```js
success({ id: 1 }, 'Order created', 201);
// { success: true, statusCode: 201, message: "Order created", data: { id: 1 } }
```

### error(message, statusCode, errors)

```js
error('Validation failed', 400, [{ field: 'phone', message: 'Invalid' }]);
// { success: false, statusCode: 400, message: "Validation failed", errors: [...] }
```

The `errors` key is omitted when no error details are supplied.

### paginated(data, page, limit, total, message)

```js
paginated(items, 1, 10, 42);
// { success: true, statusCode: 200, message, data, pagination: { page, limit, total, totalPages, hasNextPage, hasPrevPage } }
```

The pagination envelope clamps non-positive/non-finite `limit` values so `totalPages` is always finite.

---

## Why It Exists

Consistent envelopes mean:

- Clients write one response parser instead of one per endpoint.
- The `success` boolean gives an unambiguous success/failure signal.
- Pagination metadata is standardized for list endpoints.

---

## Testing

Automated tests verify:

- Default and custom success/error shapes.
- Error details inclusion/omission.
- Pagination metadata, edge cases, and limit guards.
