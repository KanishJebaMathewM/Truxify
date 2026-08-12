# Fix #825: Add validateParams UUID guard to truckRoutes and profileRoutes GET /:id endpoints

## Issue
In backend/api/src/routes/truckRoutes.js (GET /:id/number) and backend/api/src/routes/profileRoutes.js (GET /:id/name), the URL parameter :id was passed directly to Supabase queries without UUID validation. Non-UUID strings caused Postgres invalid input syntax errors, returning unhandled 500 errors.

## Root Cause
UUID validation was missing from the route definitions. When non-UUID values were passed as URL parameters, Supabase/Postgres rejected them with database errors instead of returning a proper 400 Bad Request response.

## Resolution
Applied the validateParams middleware with UUID schema validation to both endpoints:
- `truckRoutes.js` GET /:id/number
- `profileRoutes.js` GET /:id/name

This ensures invalid UUIDs are caught at the middleware level and return 400 Bad Request with descriptive error messages.

## Implementation Details

**Files Modified**:
1. `backend/api/src/routes/truckRoutes.js` (line 682)
2. `backend/api/src/routes/profileRoutes.js` (line 220)

**Route Definitions**:
```javascript
// truckRoutes.js
router.get('/:id/number', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {

// profileRoutes.js  
router.get('/:id/name', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {
```

Both endpoints now include `validateParams(uuidParamSchema)` to validate the :id parameter.

## Security Impact
- Prevents unhandled 500 errors from Postgres UUID validation failures
- Returns proper 400 Bad Request with descriptive error for malformed UUIDs
- Consistent validation across all similar endpoints
- Matches validation pattern used in orderRoutes.js

## Testing
The validation handles:
- Valid UUIDs: Returns 200 with data
- Invalid UUIDs: Returns 400 Bad Request
- Non-string values: Returns 400 Bad Request
- Null/undefined: Returns 400 Bad Request

## Verification
This fix has been verified to be in place on the current codebase.
