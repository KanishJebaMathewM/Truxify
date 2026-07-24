# Content-Type Validation

## Overview

The Truxify backend validates the `Content-Type` header for incoming requests that include a request body. This helps prevent unsupported or unexpected payload formats from reaching route handlers and reduces the application's attack surface.

The validation is implemented by the `requireJsonContent` middleware located at:

```
backend/api/src/middleware/contentType.js
```

---

## Supported Methods

Content-Type validation is applied to the following HTTP methods:

- POST
- PUT
- PATCH

The following methods bypass validation because they typically do not require a request body:

- GET
- DELETE
- HEAD
- OPTIONS

---

## Supported Media Types

The middleware currently accepts the following content types:

- `application/json`
- `application/x-www-form-urlencoded`
- `multipart/form-data`

Requests using any other media type are rejected with:

```
HTTP 415 Unsupported Media Type
```

---

## Example

### Valid Request

```http
POST /api/orders
Content-Type: application/json
```

```http
POST /api/documents
Content-Type: multipart/form-data
```

### Invalid Request

```http
POST /api/orders
Content-Type: text/plain
```

Response:

```json
{
  "error": "Unsupported Media Type.",
  "received": "text/plain",
  "allowed": [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data"
  ]
}
```

---

## Why This Validation Exists

Validating request media types provides several benefits:

- Rejects unsupported payload formats early.
- Prevents unexpected request parsing.
- Ensures only formats supported by Express middleware are accepted.
- Improves API consistency.
- Reduces the risk of malformed or unintended requests reaching application logic.

---

## Extending the Middleware

When introducing support for a new request format:

1. Update the `allowed` media types list in `backend/api/src/middleware/contentType.js`.
2. Ensure the appropriate request parser is registered (for example, Express middleware or Multer).
3. Add or update automated tests covering the new media type.
4. Update this documentation to reflect the newly supported content type.

---

## Testing

The middleware is covered by automated tests verifying:

- Supported media types are accepted.
- Unsupported media types return HTTP 415.
- Missing `Content-Type` headers are rejected for body-carrying requests.
- Safe HTTP methods continue to bypass validation.