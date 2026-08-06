# Centralized Authorization Policy Engine

## Overview

The Truxify backend uses a centralized authorization policy engine to manage all role-based and ownership-based access control in a single, auditable system. This replaces scattered inline `if (user.role !== 'admin')` checks with a unified `requirePolicy(action, getResource)` middleware pattern.

The engine is organized into two layers:

- **Core auth modules** (`src/core/auth/`) — Domain-agnostic authorization primitives (permissions, registries, evaluators)
- **Legacy policy engine** (`src/security/policyEngine.js`) — The existing named-action policy map, enhanced with structured logging and introspection

Both layers share the same permission model and can be used interchangeably.

---

# Architecture

```
Request Flow
────────────

  Incoming Request
        │
        ▼
  authenticate (JWT/session verification)
        │
        ▼
  requirePolicy('order:create', getResource?)    ◄── middleware
        │
        ▼
  policyEngine.authorize(user, action, resource)  ◄── engine
        │
        ├─ Log AUTH_GRANT or AUTH_DENIAL          ◄── authorizationLogger
        │
        ├─ next() on success
        │
        └─ res.status(401|403).json({ error })    ◄── on denial
```

---

# Core Auth Modules (`src/core/auth/`)

## File Map

```
src/core/auth/
├── index.js                 # Barrel re-exports
├── Role.js                  # Centralized ROLES constants
├── Permission.js            # Immutable permission model
├── BasePolicy.js            # Abstract policy module base class
├── PolicyRegistry.js        # Central permission registry (singleton)
├── PolicyEvaluator.js       # Role + ownership evaluation logic
├── AuthorizationError.js    # Structured error with status/errorCode
├── AuthorizationEngine.js   # Facade: registry + evaluator + logging
└── authorizationLogger.js   # Structured JSON audit logging
```

## Role.js

Centralizes the three roles in one place. All role constants are frozen.

```js
import { ROLES, isValidRole, allRoles } from './core/auth/Role.js';

ROLES.CUSTOMER   // 'customer'
ROLES.DRIVER     // 'driver'
ROLES.ADMIN      // 'admin'

isValidRole('driver')  // true
isValidRole('guest')   // false
```

## Permission.js

An immutable permission definition. Each permission has:

- `action` — The named policy action (e.g., `'order:create'`)
- `roles` — Array of allowed roles (empty = all authenticated users)
- `ownership` — Optional function `(user, resource) => boolean`
- `description` — Human-readable description

```js
import { Permission } from './core/auth/Permission.js';

const perm = new Permission({
  action: 'order:view',
  roles: ['customer', 'driver', 'admin'],
  description: 'View order details',
});

perm.isRoleAllowed('driver');   // true
perm.isRoleAllowed('guest');    // false
```

## BasePolicy.js

Abstract base class for domain-specific policy modules. Provides `define()` to register permissions within a namespace.

```js
import { BasePolicy } from './core/auth/BasePolicy.js';

class OrderPolicy extends BasePolicy {
  constructor() {
    super('order');
    this.define({ action: 'order:create', roles: ['customer'] });
    this.define({ action: 'order:view',   roles: ['customer', 'driver', 'admin'] });
  }
}
```

## PolicyRegistry.js

Central registry for all permissions. Supports registration from individual `Permission` objects, arrays, or `BasePolicy` modules.

```js
import { registry } from './core/auth/PolicyRegistry.js';

registry.register({ action: 'order:create', roles: ['customer'] });
registry.has('order:create');       // true
registry.get('order:create');       // Permission instance
registry.listActions();             // ['order:create', ...]
registry.size;                      // 1
```

## PolicyEvaluator.js

Evaluates user/action/resource against the registry. Returns `{ allowed, permission, reason }` without throwing (for programmatic use) or throws `AuthorizationError` (for middleware use).

```js
import { PolicyEvaluator } from './core/auth/PolicyEvaluator.js';

const evaluator = new PolicyEvaluator(registry);
const result = evaluator.evaluate(user, 'order:view', orderResource);
// { allowed: true, permission: { action: 'order:view', ... } }

evaluator.authorize(user, 'order:delete');
// throws AuthorizationError(403, "Role 'driver' is not permitted...")
```

## AuthorizationEngine.js

Facade that ties the registry, evaluator, and logger together. Exports a singleton instance.

```js
import { authorizationEngine } from './core/auth/AuthorizationEngine.js';

authorizationEngine.authorize(user, 'order:create');
authorizationEngine.evaluate(user, 'order:view', resource);
authorizationEngine.isRoleAllowed('order:view', 'driver');
authorizationEngine.getPolicySnapshot();
authorizationEngine.getRegisteredActions();
```

## AuthorizationError.js

Structured error class with HTTP status code and error code.

```js
const err = new AuthorizationError(403, 'Forbidden', 'FORBIDDEN');
err.status;      // 403
err.errorCode;   // 'FORBIDDEN'
err.toJSON();    // { error: 'Forbidden', errorCode: 'FORBIDDEN', status: 403 }
```

---

# Legacy Policy Engine (`src/security/policyEngine.js`)

The existing `POLICIES` map with 30+ named actions. Enhanced with:

- **Structured logging** via `authorizationLogger` (grant/denial/unknown events)
- **Ownership checks** for `driver:view-earnings` and `order:view-driver-location`
- **Introspection methods**: `isRoleAllowed()`, `getRegisteredActions()`, `getPolicySnapshot()`
- **`opts` parameter**: `authorize(user, action, resource, { requestId })` for request tracing

```js
import { policy, PolicyError } from './security/policyEngine.js';

policy.authorize(user, 'order:create', resource, { requestId: 'abc-123' });
// Logs: { event: 'AUTH_GRANT', action: 'order:create', ... }
// Throws: PolicyError(403, 'Forbidden: Insufficient privileges.')
```

### Key Policies

| Action | Roles | Ownership | Purpose |
|--------|-------|-----------|---------|
| `order:create` | customer | — | Create new orders |
| `order:upload-pod` | driver | order.owner_id | Upload proof of delivery |
| `demand:view-heatmap` | admin | — | View demand heatmap |
| `driver:view-earnings` | driver, admin | owner check | View earnings (own only for driver) |
| `ticket:view` | customer, driver, admin | owner check | View support ticket |
| `ticket:update` | admin | — | Update ticket status |
| `trip:sync-events` | driver | — | Sync trip telemetry |

---

# Middleware Integration

## requirePolicy(action, getResource?)

Drop-in middleware for route-level authorization. Replaces inline `if` checks.

```js
// Before (inline role check)
router.get('/earnings', authenticate, requireRole(['driver', 'admin']), handler);

// After (policy-based)
router.get('/earnings', authenticate, requirePolicy('driver:view-earnings', getResource), handler);
```

With ownership resolution:

```js
const getResource = async (req) => {
  const earnings = await getEarnings(req.params.driverId);
  return earnings;
};

router.get('/earnings/:driverId', authenticate, requirePolicy('driver:view-earnings', getResource), handler);
```

## Route Migration Summary

| Route File | Endpoint | Before | After |
|------------|----------|--------|-------|
| `demandRoutes.js` | GET `/heatmap` | `requireRole(['driver', 'admin'])` | `requirePolicy('demand:view-heatmap')` |
| `orderRoutes.js` | POST `/pod` | `requireRole(['driver'])` | `requirePolicy('order:upload-pod', getResource)` |
| `orderRoutes.js` | GET `/driver-location` | inline role check | `requirePolicy('order:view-driver-location', getResource)` |
| `orderRoutes.js` | GET `/route` | inline role check | `requirePolicy('order:view-route', getResource)` |
| `driverRoutes.js` | GET `/stats` | local `requireDriverRole` | `requirePolicy('driver:view-stats')` |
| `driverRoutes.js` | GET `/earnings` | `requireRole(['driver', 'admin'])` | `requirePolicy('driver:view-earnings', getResource)` |
| `supportRoutes.js` | GET/PATCH tickets | inline `user_id !== req.user.id` | `requirePolicy('ticket:view'/'ticket:update', getResource)` |
| `supportRoutes.js` | POST `/comments` | inline role check | `requirePolicy('ticket:add-comment', getResource)` |

---

# Security Improvements

## What Changed

1. **Single source of truth** — All role/action mappings in one registry, not scattered across route files
2. **Ownership enforcement** — Resource ownership is checked at the middleware layer, not ad-hoc in route handlers
3. **Structured audit logging** — Every authorization decision produces a JSON log entry (`AUTH_GRANT`/`AUTH_DENIAL`/`AUTH_UNKNOWN_ACTION`)
4. **Request tracing** — All auth logs include `requestId` and `durationMs` for performance monitoring
5. **No duplicate logging** — Authorization logging happens once in `policyEngine.authorize()`; the middleware layer only handles HTTP responses
6. **Immutable permissions** — Role arrays and permission objects are frozen after creation

## What Didn't Change

- **JWT/session verification** — `authenticate` middleware unchanged
- **Role constants** — Same `'customer'`, `'driver'`, `'admin'` values
- **Error response format** — Same `{ error: message }` shape with same status codes
- **Business logic** — Order, driver, ticket, demand logic untouched
- **Existing middleware exports** — `authenticate`, `requireRole`, `requirePolicy` all still exported from `middleware/index.js`

---

# Backward Compatibility

| Component | Status | Notes |
|-----------|--------|-------|
| `PolicyEngine` class | ✅ Preserved | Same `authorize()`, `POLICIES` map, `PolicyError` |
| `policy` singleton | ✅ Preserved | Same instance, same behavior |
| `PolicyError` | ✅ Preserved | Same `status`, `message`, `toJSON()` |
| `requirePolicy` | ✅ Enhanced | Same signature `(action, getResource)`, adds `requestId` to opts |
| `requireRole` | ✅ Preserved | Same behavior, adds structured denial logging |
| `authenticate` | ✅ Preserved | No changes |
| Route behavior | ✅ Preserved | Same auth checks, same error responses |

---

# Testing

104 tests across 2 test files covering:

- **Role validation** — `isValidRole`, `allRoles`, `ROLES` constants
- **Permission model** — `isRoleAllowed`, `checkOwnership`, `toJSON`
- **Registry operations** — `register`, `get`, `has`, `listActions`, `snapshot`
- **Evaluator logic** — role checks, ownership checks, unknown actions
- **Engine facade** — `authorize`, `evaluate`, `isRoleAllowed`, `getPolicySnapshot`
- **Error structure** — `AuthorizationError` status codes, error codes, JSON serialization
- **Policy engine enhancements** — new policies, `opts` parameter, logging integration

```bash
# Run all authorization tests
cd backend/api && npx vitest run test/unit/authorizationEngine.test.js test/unit/policyEngine.test.js
```

---

# Adding a New Policy

1. Add the policy definition to `POLICIES` in `src/security/policyEngine.js`:

```js
'payment:process': {
  roles: ['customer'],
  description: 'Process payment for an order',
},
```

2. Use it in your route:

```js
import { requirePolicy } from '../middleware/requirePolicy.js';

router.post('/pay', authenticate, requirePolicy('payment:process'), paymentHandler);
```

3. Add ownership check (optional):

```js
'payment:refund': {
  roles: ['customer', 'admin'],
  ownership: (user, resource) => user.role === 'admin' || resource.customer_id === user.id,
  description: 'Request refund for a payment',
},
```

4. Add tests in `test/unit/policyEngine.test.js`.
