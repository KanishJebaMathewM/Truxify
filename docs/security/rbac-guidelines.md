# Role-Based Access Control (RBAC) Guidelines

## Overview
Truxify uses a strict Role-Based Access Control (RBAC) system to ensure that users can only access resources appropriate for their role. The `requireRole` middleware is the primary mechanism for enforcing these rules at the API layer.

## HTTP Status Codes
It is critical to return the correct HTTP status codes to maintain API standards and ensure proper behavior with API gateways and monitoring tools.

| Status Code | Condition | Meaning |
|-------------|-----------|---------|
| `401` | `req.user` is missing or undefined | **Unauthorized**: The request lacks valid authentication credentials. The client should authenticate. |
| `403` | `req.user` exists, but `req.user.role` is not in the allowed list | **Forbidden**: The server understood the request, but refuses to authorize it due to insufficient privileges. |
| `501` | *Never used for auth failures* | **Not Implemented**: Reserved for when the server does not support the functionality to fulfill the request. |

## Usage Example
```javascript
import { authenticate, requireRole } from '../middleware/auth.js';

// Authenticate first, then require specific roles
app.post('/api/v1/admin/settings', 
  authenticate, 
  requireRole(['admin', 'super_admin']), 
  async (req, res) => {
    res.json({ success: true });
  }
);
```

## Best Practices

1. Always place authenticate middleware before requireRole.
2. Use an array of roles, even if only one role is allowed (e.g., requireRole(['admin'])).
3. Roles are case-sensitive and trimmed automatically by the middleware.
