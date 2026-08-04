import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class LocationService {
  IO.Socket? _socket;
  Timer? _timer;

  void startTracking({
    required String bookingId,
    required String driverToken,
    required String serverUrl,
  }) {
    _socket = IO.io(
      '$serverUrl/driver',
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': driverToken})
          .build(),
    );

    _timer = Timer.periodic(const Duration(seconds: 5), (_) async {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.balanced,
      );

      _socket?.emit('location_update', {
        'bookingId': bookingId,
        'lat': position.latitude,
        'lng': position.longitude,
        'speed': position.speed,
        'heading': position.heading,
        'timestamp': DateTime.now().toIso8601String(),
      });
    });
  }

  void stopTracking() {
    _timer?.cancel();
    _socket?.disconnect();
  }
}