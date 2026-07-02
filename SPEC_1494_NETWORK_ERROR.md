# Implementation Specification: Issue #1494 - Network Error Handling

## Problem
Flutter app shows blank screen with no error when network unavailable, making critical shipment data inaccessible mid-trip.

## Implementation Details

### Flutter Changes

**File: `apps/driver/lib/core/network_handler.dart`** (new file)

```dart
import 'package:connectivity_plus/connectivity_plus.dart';

class NetworkHandler {
  static final _connectivity = Connectivity();

  static Future<bool> isConnected() async {
    final result = await _connectivity.checkConnectivity();
    return result != ConnectivityResult.none;
  }

  static Stream<bool> onConnectivityChanged() {
    return _connectivity.onConnectivityChanged
        .map((result) => result != ConnectivityResult.none);
  }
}
```

**File: `apps/driver/lib/screens/home_screen.dart`** (modify)

Wrap data loading with connectivity check:

```dart
// Add to _loadShipments() method
final isConnected = await NetworkHandler.isConnected();
if (!isConnected) {
  setState(() => _showOfflineError = true);
  return;
}

try {
  // Existing load logic
} catch (e) {
  if (e is SocketException) {
    setState(() => _showOfflineError = true);
  }
  rethrow;
}
```

**File: `apps/driver/lib/widgets/offline_error_widget.dart`** (new file)

```dart
class OfflineErrorWidget extends StatelessWidget {
  final VoidCallback onRetry;

  const OfflineErrorWidget({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_off, size: 64, color: Colors.red),
          SizedBox(height: 16),
          Text('No Internet Connection'),
          SizedBox(height: 8),
          Text('Tap retry when connection is restored'),
          SizedBox(height: 24),
          ElevatedButton(
            onPressed: onRetry,
            child: Text('Retry'),
          ),
        ],
      ),
    );
  }
}
```

### Testing

- Test offline state UI renders
- Test connectivity stream updates state
- Test retry button re-attempts load
- Test cached data displays when available

## Closes #1494
