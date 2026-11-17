import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

class LocationPermissionResult {
  const LocationPermissionResult({
    required this.isGranted,
    required this.canProceed,
    this.position,
    this.errorMessage,
  });

  final bool isGranted;
  final bool canProceed;
  final Position? position;
  final String? errorMessage;
}

class LocationPermissionHelper {
  /// Checks and requests location permission for Driver App with rationale dialog, settings deep-link, and graceful fallback.
  static Future<LocationPermissionResult> handleLocationRequest(
    BuildContext context, {
    String purpose = 'track your active shipment and update live customer ETA',
  }) async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (!context.mounted) {
          return const LocationPermissionResult(isGranted: false, canProceed: false);
        }
        await _showPermissionRationaleDialog(
          context,
          title: 'Location Services Disabled',
          message: 'Location services are turned off on your device. Please turn them on in Settings to track active trips.',
          isOpenSettingsRecommended: true,
        );
        return const LocationPermissionResult(
          isGranted: false,
          canProceed: true,
          errorMessage: 'Location services disabled.',
        );
      }

      LocationPermission permission = await Geolocator.checkPermission();

      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.deniedForever) {
        if (!context.mounted) {
          return const LocationPermissionResult(isGranted: false, canProceed: false);
        }
        await _showPermissionRationaleDialog(
          context,
          title: 'Driver Location Access Required',
          message: 'Location access is required to $purpose. Please enable it in Settings → Privacy → Location Services → Truxify Driver.',
          isOpenSettingsRecommended: true,
        );
        return const LocationPermissionResult(
          isGranted: false,
          canProceed: true,
          errorMessage: 'Location permission permanently denied.',
        );
      }

      if (permission == LocationPermission.denied) {
        if (!context.mounted) {
          return const LocationPermissionResult(isGranted: false, canProceed: false);
        }
        await _showPermissionRationaleDialog(
          context,
          title: 'Location Access Needed',
          message: 'Location permission was not granted.',
          isOpenSettingsRecommended: false,
        );
        return const LocationPermissionResult(
          isGranted: false,
          canProceed: true,
          errorMessage: 'Location permission denied.',
        );
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 10),
      );

      return LocationPermissionResult(
        isGranted: true,
        canProceed: true,
        position: position,
      );
    } on PlatformException catch (e) {
      debugPrint('Driver LocationPermissionHelper PlatformException: ${e.message}');
      if (context.mounted) {
        await _showPermissionRationaleDialog(
          context,
          title: 'Location Error',
          message: 'Unable to acquire location at this moment.',
          isOpenSettingsRecommended: false,
        );
      }
      return LocationPermissionResult(
        isGranted: false,
        canProceed: true,
        errorMessage: e.message ?? 'Platform location error',
      );
    } catch (e) {
      debugPrint('Driver LocationPermissionHelper Error: $e');
      if (context.mounted) {
        await _showPermissionRationaleDialog(
          context,
          title: 'Location Error',
          message: 'Could not fetch current location.',
          isOpenSettingsRecommended: false,
        );
      }
      return LocationPermissionResult(
        isGranted: false,
        canProceed: true,
        errorMessage: e.toString(),
      );
    }
  }

  static Future<void> _showPermissionRationaleDialog(
    BuildContext context, {
    required String title,
    required String message,
    required bool isOpenSettingsRecommended,
  }) async {
    return showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.location_off_rounded, color: Colors.orange, size: 28),
            const SizedBox(width: 10),
            Expanded(child: Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
          ],
        ),
        content: Text(message, style: const TextStyle(fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Dismiss'),
          ),
          if (isOpenSettingsRecommended)
            ElevatedButton(
              onPressed: () async {
                Navigator.of(ctx).pop();
                await Geolocator.openAppSettings();
              },
              child: const Text('Open Settings'),
            ),
        ],
      ),
    );
  }
}
