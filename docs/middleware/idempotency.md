# Idempotency Middleware Guide

## Overview
The `requireIdempotency` middleware ensures that duplicate requests are handled safely by caching the response of the first successful request and returning it for subsequent identical requests.

## Header Requirements
Clients must provide the `X-Idempotency-Key` header. 

### Validation Rules
To prevent downstream errors and Redis key injection, the key must strictly adhere to the following format:
- **Type**: String
- **Length**: 1 to 255 characters
- **Allowed Characters**: Alphanumeric (`a-z`, `A-Z`, `0-9`), hyphens (`-`), and underscores (`_`)
- **Regex**: `/^[a-zA-Z0-9_-]{1,255}$/`

## Error Responses
| Status Code | Condition | Response Body |
|-------------|-----------|---------------|
| `400` | Key is missing, not a string, or fails regex validation | `{"error": "X-Idempotency-Key is malformed..."}` |
| `409` | Duplicate request is currently being processed | `{"error": "Duplicate request being processed"}` |

## Usage Example
```javascript
import { requireIdempotency } from '../middleware/idempotency.js';

app.post('/api/v1/payments', requireIdempotency(3600), async (req, res) => {
  // Process payment safely
  res.json({ success: true });
});
```
