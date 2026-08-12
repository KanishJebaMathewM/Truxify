# HTTP Parameter Pollution (HPP) Protection

## Overview

The Truxify backend includes a middleware that detects and neutralizes HTTP Parameter Pollution (HPP) attacks.

HPP occurs when a client sends multiple values for the same query parameter (e.g. `?role=customer&role=admin`). Depending on the framework, this can cause:

- Ambiguous or surprising server-side behavior.
- Authorization or filter bypasses when a framework picks a different value than expected.
- WAF evasion by smuggling an extra parameter value.

The middleware collapses duplicate query parameters to a single value so downstream handlers always see deterministic input.

---

## Location

Middleware:

```
backend/api/src/middleware/hppProtection.js
```

---

## Behavior

For every incoming request:

- Scans `req.query` for parameters whose value is an array (more than one value supplied).
- Replaces the array with the **first** supplied value, preserving backward compatibility.
- Logs a warning listing the affected parameter names.

Example:

```text
Potential HTTP Parameter Pollution detected
RequestId: ...
IP: ...
Path: /api/orders
Duplicate Params: ["status"]
```

The request continues processing with the collapsed values.

---

## Why It Exists

Duplicate query parameters are rarely intentional. They are frequently used to:

- Bypass input validation that only checks the first value.
- Confuse caching layers keyed on the raw query string.
- Probe for framework-specific parameter-parsing quirks.

This middleware makes the behavior deterministic and surfaces the attempt in the logs.

---

## Testing

Automated tests verify:

- Duplicate parameters are collapsed to the first value.
- Single-valued parameters pass through unchanged.
- Warnings are logged only when duplicates are detected.
