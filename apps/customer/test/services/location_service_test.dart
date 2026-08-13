import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:truxify/services/location_service.dart';

class _RecordingOverrides extends HttpOverrides {
  final _RecordingHttpClient client;
  _RecordingOverrides({required int statusCode, required String body})
      : client = _RecordingHttpClient(statusCode: statusCode, body: body);

  @override
  HttpClient createHttpClient(SecurityContext? context) => client;
}

class _RecordingHttpClient implements HttpClient {
  final int _statusCode;
  final String _body;
  final List<Uri> requests = <Uri>[];

  _RecordingHttpClient({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body;

  @override
  bool autoUncompress = true;

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    requests.add(url);
    return _FakeRequest(statusCode: _statusCode, body: _body);
  }

  @override
  void close({bool force = false}) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeRequest implements HttpClientRequest {
  final int _statusCode;
  final String _body;
  _FakeRequest({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body;

  @override
  final HttpHeaders headers = _FakeHeaders();

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
    return _FakeResponse(statusCode: _statusCode, body: _body);
  }

  @override
  Future<void> addStream(Stream<List<int>> stream) => stream.drain<void>();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeHeaders implements HttpHeaders {
  final Map<String, List<String>> _values = <String, List<String>>{};

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    _values[name.toLowerCase()] = <String>[value.toString()];
  }

  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {
    _values.putIfAbsent(name.toLowerCase(), () => <String>[]).add(value.toString());
  }

  @override
  void remove(String name, Object? value) {
    _values.remove(name.toLowerCase());
  }

  @override
  String? value(String name) {
    final values = _values[name.toLowerCase()];
    return (values == null || values.isEmpty) ? null : values.first;
  }

  @override
  void forEach(void Function(String, List<String>) action) {
    _values.forEach(action);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeResponse implements HttpClientResponse {
  final int _statusCode;
  final String _body;
  _FakeResponse({required int statusCode, required String body})
      : _statusCode = statusCode,
        _body = body;

  @override
  int get statusCode => _statusCode;

  @override
  String get reasonPhrase => _statusCode == 200 ? 'OK' : 'Error';

  @override
  int get contentLength => utf8.encode(_body).length;

  @override
  bool get isRedirect => false;

  @override
  bool get persistentConnection => true;

  @override
  List<RedirectInfo> get redirects => <RedirectInfo>[];

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  HttpHeaders get headers => _FakeHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.fromIterable(<List<int>>[utf8.encode(_body)])
        .listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _searchBody =
    '[{"display_name":"MG Road, Bengaluru, Karnataka, India","lat":"12.9716","lon":"77.5946"},'
    '{"display_name":"Indiranagar, Bengaluru","lat":"12.9719","lon":"77.6412"},'
    '{"display_name":"NoCoords","lat":"bad","lon":"77.1"},'
    '{"lat":"12.1","lon":"77.1"}]';

void main() {
  final service = LocationService();
  late _RecordingOverrides overrides;

  _RecordingOverrides serve(int statusCode, String body) {
    overrides = _RecordingOverrides(statusCode: statusCode, body: body);
    HttpOverrides.global = overrides;
    return overrides;
  }

  setUp(() {
    service.clearCache();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  group('searchPlaces', () {
    test('returns empty for queries shorter than 3 characters', () async {
      serve(200, _searchBody);

      final results = await service.searchPlaces('mg');

      expect(results, isEmpty);
      expect(overrides.client.requests, isEmpty);
    });

    test('parses valid results and builds the Nominatim request', () async {
      serve(200, _searchBody);

      final results = await service.searchPlaces('  MG Road Bengaluru  ');

      expect(overrides.client.requests, hasLength(1));
      final request = overrides.client.requests.single;
      expect(request.host, 'nominatim.openstreetmap.org');
      expect(request.path, '/search');
      expect(request.queryParameters['q'], 'MG Road Bengaluru');
      expect(request.queryParameters['format'], 'jsonv2');
      expect(request.queryParameters['limit'], '6');
      expect(request.queryParameters['addressdetails'], '1');

      expect(results, hasLength(2));
      expect(results[0].address, 'MG Road, Bengaluru, Karnataka, India');
      expect(results[0].point.latitude, closeTo(12.9716, 1e-9));
      expect(results[0].point.longitude, closeTo(77.5946, 1e-9));
      expect(results[1].address, 'Indiranagar, Bengaluru');
    });

    test('serves repeat queries from cache without a new request', () async {
      serve(200, _searchBody);

      final first = await service.searchPlaces('MG Road');
      final second = await service.searchPlaces('mg road');

      expect(first, same(second));
      expect(overrides.client.requests, hasLength(1));
    });

    test('throws on non-200 responses', () async {
      serve(503, 'nope');

      expect(() => service.searchPlaces('MG Road'), throwsA(isA<Exception>()));
    });

    test('throws on unexpected response types', () async {
      serve(200, '{"error":"unexpected"}');

      expect(() => service.searchPlaces('MG Road'), throwsA(isA<Exception>()));
    });
  });

  group('resolveAddress', () {
    test('returns display_name and caches it', () async {
      serve(200, '{"display_name":"Taj Mahal, Agra, Uttar Pradesh, India"}');

      final first = await service.resolveAddress(const LatLng(27.1751, 78.0421));
      final second = await service.resolveAddress(const LatLng(27.1751, 78.0421));

      expect(first, 'Taj Mahal, Agra, Uttar Pradesh, India');
      expect(second, first);
      expect(overrides.client.requests, hasLength(1));
    });

    test('throws on non-200 responses', () async {
      serve(500, 'nope');

      expect(
        () => service.resolveAddress(const LatLng(27.1751, 78.0421)),
        throwsA(isA<Exception>()),
      );
    });

    test('throws when display_name is missing', () async {
      serve(200, '{"place_id":1}');

      expect(
        () => service.resolveAddress(const LatLng(27.1751, 78.0421)),
        throwsA(isA<Exception>()),
      );
    });
  });

  group('address parsing helpers', () {
    test('extractCity picks the third-from-last part', () {
      expect(service.extractCity('12, MG Road, Bengaluru, Karnataka, India'), 'Bengaluru');
      expect(service.extractCity('Bengaluru'), 'Bengaluru');
      expect(service.extractCity(''), '');
    });

    test('extractShortAddress keeps the first three parts', () {
      expect(
        service.extractShortAddress('12, MG Road, Bengaluru, Karnataka, India'),
        '12, MG Road, Bengaluru',
      );
      expect(service.extractShortAddress('MG Road'), 'MG Road');
    });
  });

  test('clearCache forces a fresh lookup', () async {
    serve(200, _searchBody);

    await service.searchPlaces('MG Road');
    service.clearCache();
    await service.searchPlaces('MG Road');

    expect(overrides.client.requests, hasLength(2));
  });
}
