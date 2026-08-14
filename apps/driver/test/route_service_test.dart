import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:truxify_driver/services/route_service.dart';

class _FakeHttpOverrides extends HttpOverrides {
  final _FakeHttpClient client;
  _FakeHttpOverrides({required int statusCode, required String body})
      : client = _FakeHttpClient(statusCode: statusCode, body: body);
  _FakeHttpOverrides.throwOnClose() : client = _FakeHttpClient.throwOnClose();

  @override
  HttpClient createHttpClient(SecurityContext? context) => client;
}

class _FakeHttpClient implements HttpClient {
  final int? _statusCode;
  final String? _body;
  final bool _throwOnClose;

  _FakeHttpClient({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body,
        _throwOnClose = false;
  _FakeHttpClient.throwOnClose()
      : _statusCode = null,
        _body = null,
        _throwOnClose = true;

  @override
  bool autoUncompress = true;

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    if (_throwOnClose) return _FakeHttpClientRequest.throwOnClose();
    return _FakeHttpClientRequest(
      statusCode: _statusCode!,
      body: _body!,
    );
  }

  @override
  void close({bool force = false}) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpClientRequest implements HttpClientRequest {
  final int? _statusCode;
  final String? _body;
  final bool _throwOnClose;

  _FakeHttpClientRequest({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body,
        _throwOnClose = false;
  _FakeHttpClientRequest.throwOnClose()
      : _statusCode = null,
        _body = null,
        _throwOnClose = true;

  @override
  final HttpHeaders headers = _FakeHttpHeaders();

  @override
  bool followRedirects = true;

  @override
  int maxRedirects = 5;

  @override
  int contentLength = -1;

  @override
  bool persistentConnection = true;

  @override
  Future<HttpClientResponse> close() async {
    if (_throwOnClose) {
      throw const SocketException('Connection refused');
    }
    return _FakeHttpClientResponse(statusCode: _statusCode!, body: _body!);
  }

  @override
  Future<void> addStream(Stream<List<int>> stream) => stream.drain<void>();

  @override
  void abort([Object? exception, StackTrace? stackTrace]) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpClientResponse implements HttpClientResponse {
  final int _statusCode;
  final String _body;

  _FakeHttpClientResponse({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body;

  @override
  int get statusCode => _statusCode;

  @override
  int get contentLength => utf8.encode(_body).length;

  @override
  bool get isRedirect => false;

  @override
  List<RedirectInfo> get redirects => const [];

  @override
  bool get persistentConnection => false;

  @override
  String get reasonPhrase => _statusCode == 200 ? 'OK' : 'Error';

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  final HttpHeaders headers = _FakeHttpHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.fromIterable([utf8.encode(_body)]).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHttpHeaders implements HttpHeaders {
  final Map<String, List<String>> _values = {};

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    _values[name.toLowerCase()] = [value.toString()];
  }

  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {
    (_values[name.toLowerCase()] ??= []).add(value.toString());
  }

  @override
  void forEach(void Function(String name, List<String> values) f) {
    _values.forEach(f);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('RouteService.fetchRouteGeoJson', () {
    test('returns an empty list when fewer than two points are provided', () async {
      expect(await RouteService.fetchRouteGeoJson(const []), isEmpty);
      expect(
        await RouteService.fetchRouteGeoJson([const LatLng(12.9716, 77.5946)]),
        isEmpty,
      );
    });

    test('returns an empty list when the response is not 200', () async {
      HttpOverrides.global = _FakeHttpOverrides(statusCode: 500, body: 'oops');

      final result = await RouteService.fetchRouteGeoJson(
        [const LatLng(0, 0), const LatLng(1, 1)],
      );

      expect(result, isEmpty);
    });

    test('parses a GeoJSON route into ordered LatLng points', () async {
      final body = jsonEncode({
        'routes': [
          {
            'geometry': {
              'coordinates': [
                [77.5946, 12.9716],
                [77.6, 12.98],
                [77.61, 12.99],
              ],
            },
          },
        ],
      });
      HttpOverrides.global = _FakeHttpOverrides(statusCode: 200, body: body);

      final result = await RouteService.fetchRouteGeoJson(
        [const LatLng(12.9716, 77.5946), const LatLng(12.99, 77.61)],
      );

      expect(result, hasLength(3));
      expect(result.first.latitude, 12.9716);
      expect(result.first.longitude, 77.5946);
      expect(result.last.latitude, 12.99);
      expect(result.last.longitude, 77.61);
    });

    test('returns an empty list when the response is not valid GeoJSON', () async {
      HttpOverrides.global = _FakeHttpOverrides(statusCode: 200, body: '[]');

      final result = await RouteService.fetchRouteGeoJson(
        [const LatLng(0, 0), const LatLng(1, 1)],
      );

      expect(result, isEmpty);
    });

    test('returns an empty list on transport errors', () async {
      HttpOverrides.global = _FakeHttpOverrides.throwOnClose();

      final result = await RouteService.fetchRouteGeoJson(
        [const LatLng(0, 0), const LatLng(1, 1)],
      );

      expect(result, isEmpty);
    });
  });
}
