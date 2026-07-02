# Implementation Specification: Issue #1011 - Remove Hardcoded Driver ID

## Problem
Driver ID derived from compile-time constant in code paths, creating hardcoded credential risk.

## Implementation Details

**File: `apps/driver/lib/config/constants.dart`** (REMOVE)

DELETE this:
```dart
const String DRIVER_ID = '12345'; // REMOVE - compile-time constant
```

**File: `apps/driver/lib/services/auth_service.dart`** (modify)

Replace hardcoded ID with authenticated session:

```dart
class AuthService {
  Future<String> getDriverId() async {
    // Get from authenticated user session
    final user = await supabase.auth.currentUser;
    if (user == null) throw Exception('Not authenticated');
    
    // Get driver record with ID
    final response = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', user.id)
        .single();
    
    return response['id'];
  }
}
```

**File: `apps/driver/lib/screens/home_screen.dart`** (search and replace all uses)

Replace:
```dart
const driverId = DRIVER_ID; // OLD
```

With:
```dart
final driverId = await authService.getDriverId(); // NEW
```

### Code Audit Required

Search codebase for:
- `DRIVER_ID` references
- Hardcoded driver IDs
- Compile-time constants for credentials

### Testing

- Test getDriverId() returns authenticated user's ID
- Test unauthenticated calls throw error
- Test ID matches current user in Supabase

## Closes #1011
