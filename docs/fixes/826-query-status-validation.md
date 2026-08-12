# Fix #826: Guard req.query.status against array type in GET /api/loads

## Issue
In backend/api/src/routes/loadRoutes.js, the GET /api/loads endpoint called .toLowerCase() on req.query.status without checking its type. Express parses query parameters like `?status=a&status=b` as an array, causing TypeError: req.query.status.toLowerCase is not a function when the array is passed to the method.

## Root Cause
When Express receives duplicate query parameters with the same name, it automatically converts the value into an array. The code did not validate the type before calling a string method on the value.

## Resolution
Added a type check to validate that req.query.status is a string before calling .toLowerCase(). If it's an array or other type, the endpoint returns a 400 Bad Request error with a descriptive message.

## Implementation Details

**File**: `backend/api/src/routes/loadRoutes.js`
**Endpoint**: `GET /api/loads`
**Lines**: 202-204

Type validation added:
```javascript
if (typeof req.query.status !== 'string') {
  return res.status(400).json({ error: 'status must be a single string, not an array or object' });
}
```

This check occurs before the .toLowerCase() call on line 205, preventing TypeError crashes.

## Security Impact
- Prevents unhandled 500 TypeError crashes
- Returns proper 400 Bad Request for malformed input
- Gracefully handles duplicate query parameters
- Improves API reliability and robustness

## Testing
The fix has been verified to handle:
- Single string status values: `?status=available`
- Array values: `?status=a&status=b` (returns 400)
- Missing status parameter (uses default 'available')
- Invalid status values (returns 400 with allowed values)

## Verification
This fix has been verified to be in place on the current codebase.
