# Order Display ID

## Overview

Orders in Truxify carry a human-friendly display ID used across the customer app, driver app, and on-chain escrow booking. The helper (`lib/orderDisplayId.js`) generates and validates these IDs.

---

## Location

```
backend/api/src/lib/orderDisplayId.js
```

---

## Format

```
#FF<YYYYMMDD><12-char alphanumeric>
```

For example: `#FF20260802K9X2Q7Z4M1A3`

- `#FF` prefix.
- 8-digit UTC date (`YYYYMMDD`).
- 12 characters drawn uniformly from `A-Z0-9` via `crypto.randomInt` (no modulo bias).

---

## Uniqueness

The random suffix space is 36^12 (~4.7e18) values per calendar day — collisions are effectively impossible. As a safety net, callers re-roll on a unique-constraint violation (code 23505), bounded by `ORDER_DISPLAY_ID_MAX_RETRIES` (5).

---

## API

| Function | Behavior |
|----------|----------|
| `generateOrderDisplayId()` | Returns a new display ID |
| `isValidOrderDisplayId(id)` | Returns true only for `/^#FF\d{8}[A-Z0-9]{12}$/` |

---

## Why It Exists

- Human-friendly IDs are easier for drivers/customers to quote than UUIDs.
- The display ID is the basis for the on-chain escrow booking ID, so uniqueness keeps orders and escrow bookings 1:1.
- The strict format lets any layer validate an ID before using it.

---

## Testing

Automated tests verify:

- Generated IDs match the format.
- Validation accepts valid IDs and rejects malformed ones.
- Uniqueness of generated IDs.
