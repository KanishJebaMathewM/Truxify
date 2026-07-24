# Logging Guidelines

## Overview

The Truxify backend uses **Pino** for structured application logging.

To reduce the risk of accidentally exposing sensitive information, the logger automatically redacts configured fields before log entries are written.

---

# Automatic Redaction

The logger replaces sensitive values with:

```text
[REDACTED]
```

instead of logging the original value.

---

# Redacted Fields

The following fields are automatically redacted whenever they appear in structured log objects:

- Authorization headers
- Cookies
- Passwords
- API Keys
- Access Tokens
- Refresh Tokens
- Client Secrets

Examples of protected paths include:

- `req.headers.authorization`
- `req.headers.cookie`
- `headers.authorization`
- `headers.cookie`
- `authorization`
- `password`
- `accessToken`
- `refreshToken`
- `apiKey`
- `secret`

---

# Example

## Before Redaction

```json
{
  "authorization": "Bearer eyJhbGciOiJIUzI1NiIs...",
  "password": "myPassword123",
  "userId": "123"
}
```

## Logged Output

```json
{
  "authorization": "[REDACTED]",
  "password": "[REDACTED]",
  "userId": "123"
}
```

---

# Best Practices

When adding new logging statements:

- Log structured objects whenever possible.
- Never manually log passwords or authentication tokens.
- Avoid logging cookies or session identifiers.
- Log only the information required for debugging.
- Add newly introduced sensitive fields to the logger redaction configuration.

---

# Extending Redaction

If a new credential or secret field is introduced, update the logger configuration by adding the corresponding property path to the Pino `redact.paths` configuration.

This ensures future log entries automatically redact the new field without requiring changes throughout the codebase.

---

# Benefits

- Prevents accidental credential exposure.
- Improves production log safety.
- Maintains structured logging.
- Reduces the risk of sensitive information leaking into centralized logging systems.
