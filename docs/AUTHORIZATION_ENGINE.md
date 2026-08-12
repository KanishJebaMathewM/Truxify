# Centralized Authorization Engine

## Overview

The Truxify backend centralizes authorization in a policy engine (`core/auth/` + `security/policyEngine.js`). Routes declare named actions, and the engine resolves the roles and ownership rules that permit them — no ad-hoc role checks scattered across handlers.

---

## Location

```
backend/api/src/core/auth/Permission.js        — a single action + roles + ownership
backend/api/src/core/auth/PolicyRegistry.js    — registry of permissions
backend/api/src/core/auth/BasePolicy.js        — base class for domain policies
backend/api/src/core/auth/PolicyEvaluator.js   — evaluate/authorize
backend/api/src/core/auth/AuthorizationEngine.js — facade
backend/api/src/core/auth/authorizationLogger.js — audit-friendly log entries
backend/api/src/security/policyEngine.js       — application policy wiring
backend/api/src/middleware/requirePolicy.js    — route guard
```

---

## Concepts

- **Permission** — an action (e.g. `order:cancel`) with an optional role allow-list and an optional ownership check `(user, resource) => boolean`.
- **Registry** — a single source of truth; registering a duplicate action throws.
- **BasePolicy** — domain policy modules (`OrderPolicy`, `DriverPolicy`) that `define()` permissions and register them.
- **Evaluator** — `evaluate(user, action, resource)` returns allow/deny; `authorize` throws `AuthorizationError` on denial.
- **requirePolicy middleware** — guards routes with a named action after `authenticate`.

---

## Ownership

Permissions can carry an ownership function so authorization is resource-aware (e.g. a customer may only view their own order's bids). Without a resource, ownership checks are skipped.

---

## Why It Exists

Named policies make authorization intent visible at the route declaration, support resource-level ownership checks, and produce a consistent audit trail through the authorization logger.

---

## Testing

Automated tests verify:

- Registration and duplicate rejection.
- Role allow/deny and ownership checks.
- Unknown action and unauthenticated handling.
- Policy module registration.
- Middleware behavior.
