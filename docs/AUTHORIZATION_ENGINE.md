# Centralized Authorization Engine

The authorization engine centralizes roles, permissions, and policy
evaluation for the API.

## Concepts

- **Role** (`core/auth/Role.js`) — `customer`, `driver`, `admin`. Use the
  `ROLES` constants instead of hardcoded strings.
- **Permission** (`core/auth/Permission.js`) — a single atomic check: an
  action, an optional role allow-list, and an optional ownership function.
  Permissions are immutable once created.
- **PolicyRegistry** (`core/auth/PolicyRegistry.js`) — the single source of
  truth mapping action names to permissions.
- **BasePolicy** (`core/auth/BasePolicy.js`) — base class for grouping
  permissions into domain policy modules.
- **PolicyEvaluator** (`core/auth/PolicyEvaluator.js`) — decides whether a
  user may perform an action, applying role and ownership rules.
- **AuthorizationError** — structured 401/403 error with a machine-readable
  `errorCode`.

## Usage

```js
import { registry, Permission } from '../core/auth/index.js';

registry.register(new Permission({
  action: 'order:view',
  roles: ['customer', 'driver'],
  ownership: (user, order) => user.id === order.customer_id || user.id === order.driver_id,
}));

const result = evaluator.evaluate(user, 'order:view', { order });
```

## Error codes

| Status | Code                |
| ------ | ------------------- |
| 401    | `UNAUTHENTICATED`   |
| 403    | `FORBIDDEN`         |
| other  | `AUTHORIZATION_ERROR` |

## Middleware

`requirePolicy(action)` (in `middleware/requirePolicy.js`) uses the evaluator
to gate routes; unknown actions and unauthenticated requests fail closed.
