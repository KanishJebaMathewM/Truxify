/// Non-web fallback for the conditional import in location_service.dart.
/// Never actually called — the call site is guarded by kIsWeb.
Future<Map<String, double>> getBrowserGeolocation() =>
    throw UnsupportedError('Browser geolocation is only available on web.');
