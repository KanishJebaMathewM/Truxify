# Implementation Specification: Issue #1010 - Enforce Supabase RLS Policies

## Problem
Supabase Row Level Security policies not enforced for driver location data. Drivers can access other drivers' location data.

## Implementation Details

**File: `supabase/migrations/add_rls_driver_location.sql`** (new migration)

```sql
-- Enable RLS on driver_location table
ALTER TABLE driver_location ENABLE ROW LEVEL SECURITY;

-- Policy: Drivers can only see their own location
CREATE POLICY "Drivers see own location"
  ON driver_location
  FOR SELECT
  USING (
    driver_id = (
      SELECT id FROM drivers 
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Only drivers can update own location
CREATE POLICY "Drivers update own location"
  ON driver_location
  FOR UPDATE
  USING (
    driver_id = (
      SELECT id FROM drivers 
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Admins can view all locations
CREATE POLICY "Admins view all locations"
  ON driver_location
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

**File: `backend/api/src/routes/location.routes.js`** (verify)

Ensure all location queries use authenticated user:

```javascript
router.get('/my-location', async (req, res) => {
  const userId = req.user.id; // Authenticated user
  
  const location = await db.query(
    'SELECT * FROM driver_location WHERE driver_id = ?',
    [userId]
  );
  
  res.json(location);
});
```

### Testing

- Test driver A cannot see driver B's location
- Test admin can see all locations
- Test policy blocks direct table access
- Test RLS prevents query bypass

## Closes #1010
