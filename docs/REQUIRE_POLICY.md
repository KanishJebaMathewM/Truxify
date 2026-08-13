# Policy-Based Access Control (requirePolicy)

## Overview

The Truxify backend uses a centralized policy engine for authorization. The `requirePolicy` middleware guards routes with named actions, evaluated against the authenticated user by the authorization engine.

---

## Location

Middleware:

```
backend/api/src/middleware/requirePolicy.js
```

Policy engine:

```
backend/api/src/security/policyEngine.js
```

Authorization core:

```
backend/api/src/core/auth/
```

---

## Usage

```js
router.get('/admin/dashboard',
  authenticate,
  requirePolicy('admin:view-dashboard'),
  handler);
```

Routes are declared with policy actions (e.g. `admin:view-dashboard`, `order:cancel`, `shard:query-orders`) instead of bare role names. The policy engine resolves the action to the roles and ownership rules that permit it.

---

## Behavior

- Must run after `authenticate` (which populates `req.user`).
- Evaluates the action against the user's role and, where defined, resource ownership.
- Denials return `403 Forbidden` with a structured message.
- Unauthenticated requests return `401`.

---

## Why It Exists

Centralized, named policies:

- Make authorization intent readable at the route declaration.
- Allow ownership checks (resource-level) in addition to role checks.
- Produce a consistent audit trail through the authorization logger.

---

## Testing

Automated tests verify:

- Allowed and denied role outcomes.
- Ownership-based grants and denials.
- Unauthenticated handling.
- Unknown action handling.
