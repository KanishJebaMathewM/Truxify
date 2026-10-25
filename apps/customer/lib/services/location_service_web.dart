import 'dart:async';
import 'dart:js_interop';
import 'package:web/web.dart' as web;

/// Browser Geolocation API implementation (web only — resolved via the
/// conditional import in location_service.dart).
Future<Map<String, double>> getBrowserGeolocation() async {
  final completer = Completer<Map<String, double>>();
  web.window.navigator.geolocation.getCurrentPosition(
    (web.GeolocationPosition pos) {
      completer.complete({
        'latitude': pos.coords.latitude.toDouble(),
        'longitude': pos.coords.longitude.toDouble(),
      });
    }.toJS,
    (web.GeolocationPositionError e) {
      completer.completeError(
        Exception('Browser geolocation failed: ${e.message}'),
      );
    }.toJS,
  );
  return completer.future;
}
