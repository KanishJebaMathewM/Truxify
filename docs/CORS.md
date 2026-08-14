# CORS Middleware

## Overview

The Truxify backend configures Cross-Origin Resource Sharing (CORS) through a single middleware that restricts which browser origins may call the API.

---

## Location

Middleware:

```
backend/api/src/middleware/cors.js
```

---

## Configuration

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Comma-separated whitelist of allowed origins (e.g. `https://app.truxify.in,https://admin.truxify.in`) |

Only `http:` and `https:` URLs are accepted into the whitelist.

---

## Behavior

- Requests with no `Origin` header (server-to-server, curl, mobile apps) are allowed.
- Origins in the `ALLOWED_ORIGINS` whitelist are allowed.
- In non-production environments, `localhost` / `127.0.0.1` origins on any port are allowed for local development.
- All other origins are denied (`callback(null, false)`).

Allowed methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.

Allowed headers:

- Production: `Content-Type`, `Authorization`.
- Non-production additionally: `x-user-id`, `x-user-role`, `x-user-name`.

---

## Why It Exists

An overly permissive CORS policy (`Access-Control-Allow-Origin: *`) lets any website make credentialed calls to the API from a victim's browser. The whitelist keeps browser access limited to the real applications while leaving server-to-server and mobile traffic unaffected.

---

## Testing

Automated tests verify:

- Whitelisted origins are allowed.
- Unknown origins are denied.
- Localhost is allowed in non-production.
- Requests without an origin are allowed.
