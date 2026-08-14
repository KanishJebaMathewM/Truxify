# Suspicious Request Detection

## Overview

The Truxify backend includes a middleware that inspects incoming requests for common web-attack signatures before they reach route handlers.

The middleware scans:

- The JSON-serialized request body.
- The JSON-serialized query string.
- The request URL.
- The `User-Agent` header.

Matches are logged, and high-confidence attacks (SQL injection and path traversal) are blocked with HTTP 403.

---

## Location

Middleware:

```
backend/api/src/middleware/suspiciousRequests.js
```

---

## Detection Categories

| Category | Example Signatures |
|----------|--------------------|
| SQL Injection | `union select`, `drop table`, `insert into`, `delete from`, `or 1=1`, SQL comment markers |
| Cross-Site Scripting | `<script`, `javascript:`, `onerror=`, `onload=` |
| Path Traversal | `../`, `..\\`, URL-encoded `%2e%2e` |
| Suspicious User-Agent | `sqlmap`, `nikto`, `curl`, `wget` |

---

## Behavior

- Detected findings are attached to the request as `req.suspicious = true` and `req.threatFindings`.
- A warning log entry records the request ID, IP, path, findings, and user agent.
- **SQL Injection** and **Path Traversal** findings block the request with `403 Request blocked: suspicious content detected`.
- XSS and suspicious user-agent findings are logged but do not block, so legitimate tools that happen to match are not disrupted.

---

## Why It Exists

Signature-based inspection is a cheap first line of defense that:

- Surfaces probing attempts in logs for security review.
- Blocks trivial injection attempts before they reach database code.
- Complements the parameterized queries, validation schemas, and RLS policies used elsewhere in the API.

It is not a substitute for parameterized SQL, input validation, or a WAF — it is defense in depth.

---

## Testing

Automated tests verify:

- SQL injection signatures in the body/query are blocked with 403.
- Path traversal signatures in the URL are blocked with 403.
- XSS signatures are flagged but do not block.
- Clean requests pass through unchanged.
