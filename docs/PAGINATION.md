# Pagination Middleware

## Overview

The Truxify backend includes a strict pagination middleware that parses, normalizes, and caps list-query parameters to prevent memory exhaustion from large `limit` values.

---

## Location

Middleware:

```
backend/api/src/middleware/pagination.js
```

---

## Behavior

For every request passing through `validatePagination()`:

- Parses `limit` (default 10, capped at `maxLimit`).
- Parses `offset` (default 0, capped at `maxOffset`) or `page` (computed as `(page - 1) * limit`).
- Rejects non-integer or negative values with `400`.
- Reassigns the normalized values back onto `req.query.limit` and `req.query.offset` so downstream controllers always see safe values.
- Exposes the resolved values as `req.pagination = { limit, offset }`.
- Injects an `X-Total-Count` response header when the JSON body carries `totalCount`, `count`, or `total`.

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxLimit` | `100` | Maximum allowed page size |
| `maxOffset` | `10000` | Maximum allowed offset |
| `defaultLimit` | `10` | Page size when unspecified |
| `defaultOffset` | `0` | Offset when unspecified |

---

## Why It Exists

Unbounded `limit` values (e.g. `?limit=1000000000`) force the database to materialize huge result sets, which can exhaust memory and degrade the whole API. Capping and normalizing these parameters protects list endpoints.

---

## Testing

Automated tests verify:

- Limits above the cap are clamped.
- Invalid values return 400.
- Page-based offsets are computed correctly.
- The `X-Total-Count` header is injected when a count is present.
