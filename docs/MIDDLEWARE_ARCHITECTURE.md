# Middleware Architecture

## Overview

The Truxify backend uses Express middleware to process every incoming request before it reaches the route handlers. Middleware is responsible for handling request parsing, security, logging, authentication, validation, and error handling.

This document explains the middleware execution flow, recommended ordering, and best practices for adding new middleware.

---

# Middleware Execution Flow

```
Incoming Request
        │
        ▼
Security Middleware
        │
        ▼
Request Logging & Correlation
        │
        ▼
Body Parsing
        │
        ▼
Authentication & Authorization
        │
        ▼
Request Validation
        │
        ▼
Route Handlers
        │
        ▼
Response Processing
        │
        ▼
Error Handling
        │
        ▼
Outgoing Response
```

---

# Recommended Middleware Order

Middleware should be registered in the following order:

1. Security middleware
2. Request ID / Logging
3. Request parsing
4. Authentication
5. Validation
6. Application routes
7. Error handling middleware

Keeping this order ensures requests are validated and logged before business logic executes.

---

# Middleware Responsibilities

## Security Middleware

Security middleware should execute before all route handlers.

Typical responsibilities include:

- HTTP security headers
- Request sanitization
- Suspicious request logging
- Rate limiting

---

## Logging Middleware

Logging middleware should attach request metadata that remains available throughout the request lifecycle.

Typical responsibilities include:

- Request ID generation
- Correlation ID propagation
- Request timing
- Structured logging

---

## Authentication Middleware

Authentication middleware verifies the identity of the requester before protected endpoints are executed.

Typical responsibilities include:

- JWT verification
- Session validation
- User context attachment

---

## Validation Middleware

Validation middleware should verify request parameters before controller logic runs.

Typical responsibilities include:

- Body validation
- Query validation
- Parameter validation

---

## Error Handling Middleware

Error handling middleware should be registered after all routes.

Responsibilities include:

- Formatting API errors
- Logging unexpected failures
- Returning consistent error responses

---

# Best Practices

When adding a new middleware:

- Keep middleware focused on a single responsibility.
- Avoid modifying request data unless necessary.
- Prefer asynchronous implementations when possible.
- Return early when validation fails.
- Do not expose sensitive information in logs.
- Keep middleware reusable across routes.

---

# Folder Structure

```
backend/api/src/
└── middleware/
    ├── securityHeaders.js
    ├── requestId.js
    ├── suspiciousRequests.js
    ├── responseSanitizer.js
    └── index.js
```

---

# Adding a New Middleware

1. Create the middleware inside `backend/api/src/middleware/`.
2. Export it from `middleware/index.js`.
3. Register it in the application entry point.
4. Add unit tests.
5. Update this document if the execution flow changes.

---

# Testing

Middleware should be tested for:

- Successful execution
- Error handling
- Request/response mutations
- Logging behavior
- Execution order

---

# Future Improvements

Potential enhancements include:

- Middleware performance metrics
- Request tracing integration
- Configurable middleware loading
- Plugin-based middleware registration