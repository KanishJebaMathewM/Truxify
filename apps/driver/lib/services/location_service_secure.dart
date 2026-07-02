import 'package:geolocator/geolocator.dart';

/// Secure location service with runtime permission checks.
/// Fixes issue #1491: prevents crashes from missing permissions on Android 10+ and iOS 14+.
class SecureLocationService {
  /// Get current location with proper permission handling.
  /// Returns null if permissions are denied.
  static Future<Position?> getCurrentLocation() async {
    try {
      // Check permission status first
      LocationPermission permission = await Geolocator.checkPermission();
      
      if (permission == LocationPermission.denied) {
        // Request permission if not yet asked
        permission = await Geolocator.requestPermission();
        
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          print('Location permission denied');
          return null;
        }
      }
      
      if (permission == LocationPermission.deniedForever) {
        print('Location permissions permanently denied. Open app settings to enable.');
        return null;
      }
      
      // Permission granted - get location
      return await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
    } catch (e) {
      print('Error getting location: $e');
      return null;
    }
  }
  
  /// Check if location permissions are granted.
  static Future<bool> isLocationGranted() async {
    final permission = await Geolocator.checkPermission();
    return permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
  }
  
  /// Request location permission.
  static Future<bool> requestLocationPermission() async {
    final permission = await Geolocator.requestPermission();
    return permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
  }
}
