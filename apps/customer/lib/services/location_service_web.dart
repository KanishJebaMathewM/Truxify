import 'dart:async';
import 'dart:html' as html;

/// Browser Geolocation API implementation (web only — resolved via the
/// conditional import in location_service.dart).
Future<Map<String, double>> getBrowserGeolocation() async {
  final completer = Completer<Map<String, double>>();
  html.window.navigator.geolocation.getCurrentPosition().then((pos) {
    completer.complete({
      'latitude': pos.coords!.latitude!.toDouble(),
      'longitude': pos.coords!.longitude!.toDouble(),
    });
  }).catchError((e) {
    completer.completeError(Exception('Browser geolocation failed: $e'));
  });
  return completer.future;
}
