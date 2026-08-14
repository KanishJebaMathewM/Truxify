/// Location Mapper Utility for Flutter Background Isolate Thread Pool
class LocationMapper {
  static Map<String, dynamic> formatTelemetryPayload({
    required String driverId,
    required String orderId,
    required double lat,
    required double lng,
    required double speed,
    required double bearing,
  }) {
    return {
      'driver_id': driverId,
      'order_id': orderId,
      'lat': lat,
      'lng': lng,
      'speed': speed,
      'bearing': bearing,
      'device_timestamp': DateTime.now().toIso8601String(),
    };
  }
}
