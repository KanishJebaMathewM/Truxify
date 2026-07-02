# Implementation Specification: Issue #1491 - Geolocation Permission Checks

## Problem
Flutter app requests geolocation without runtime permission check, causing PlatformException crash on Android 10+ and iOS 14+.

## Implementation Details

**File: `apps/driver/lib/services/location_service.dart`** (modify)

Add permission checks before location request:

```dart
import 'package:permission_handler/permission_handler.dart';
import 'package:geolocator/geolocator.dart';

class LocationService {
  static Future<Position?> getCurrentLocation() async {
    // Check permission
    final status = await Permission.location.request();
    
    if (status.isDenied) {
      throw Exception('Location permission denied');
    }
    
    if (status.isPermanentlyDenied) {
      openAppSettings();
      throw Exception('Location permissions permanently denied');
    }

    return await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );
  }
}
```

**File: `apps/driver/pubspec.yaml`** (ensure dependency)

```yaml
dependencies:
  permission_handler: ^11.0.0
  geolocator: ^9.0.0
```

**File: `apps/driver/android/app/src/main/AndroidManifest.xml`** (add)

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

### Testing

- Test permission check before location
- Test permission denied handling
- Test permanent denial handling
- Test success on permission granted

## Closes #1491
