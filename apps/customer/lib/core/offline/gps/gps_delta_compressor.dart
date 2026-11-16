
import 'dart:async';
import 'dart:math' as math;

class GpsPoint {
  const GpsPoint({
    required this.latitude,
    required this.longitude,
    required this.timestampMs,
  });

  final double latitude;
  final double longitude;
  final int timestampMs;
}

class GpsBatch {
  GpsBatch(List<GpsPoint> points)
      : points = List<GpsPoint>.unmodifiable(points);

  final List<GpsPoint> points;
}

class GpsDeltaCompressor {
  GpsDeltaCompressor({
    this.minDistanceMeters = 25.0,
    this.flushInterval = const Duration(seconds: 30),
  }) {
    if (!minDistanceMeters.isFinite || minDistanceMeters < 0) {
      throw ArgumentError.value(
        minDistanceMeters,
        'minDistanceMeters',
        'Must be a finite, non-negative distance.',
      );
    }

    if (flushInterval <= Duration.zero) {
      throw ArgumentError.value(
        flushInterval,
        'flushInterval',
        'Must be greater than zero.',
      );
    }

    _timer = Timer.periodic(flushInterval, (_) => _flush());
  }

  final double minDistanceMeters;
  final Duration flushInterval;

  final List<GpsPoint> _buffer = <GpsPoint>[];
  final List<GpsBatch> _pending = <GpsBatch>[];

  Timer? _timer;
  bool _disposed = false;

  List<GpsBatch> add(GpsPoint point) {
    _ensureNotDisposed();
    _validatePoint(point);

    if (_buffer.isNotEmpty &&
        point.timestampMs < _buffer.last.timestampMs) {
      throw ArgumentError(
        'GPS timestamps must be in chronological order.',
      );
    }

    if (_buffer.isEmpty) {
      _buffer.add(point);
      return [];
    }

    final previous = _buffer.last;
    final moved =
        _distanceMeters(previous, point) >= minDistanceMeters;

    final elapsed =
        point.timestampMs - _buffer.first.timestampMs >=
            flushInterval.inMilliseconds;

    _buffer.add(point);

    if (moved || elapsed) {
      final batch = _createBatch();
      _pending.add(batch);
      return [batch];
    }

    return [];
  }

  List<GpsBatch> drain() {
    _ensureNotDisposed();

    final batches = List<GpsBatch>.of(_pending);
    _pending.clear();

    if (_buffer.isNotEmpty) {
      batches.add(_createBatch());
    }

    return batches;
  }

  void dispose() {
    if (_disposed) return;

    _timer?.cancel();
    _timer = null;
    _disposed = true;
  }

  GpsBatch _createBatch() {
    final batch = GpsBatch(_buffer);
    _buffer.clear();
    return batch;
  }

  void _flush() {
    if (_disposed || _buffer.isEmpty) return;

    _pending.add(_createBatch());
  }

  void _ensureNotDisposed() {
    if (_disposed) {
      throw StateError(
        'GpsDeltaCompressor has already been disposed.',
      );
    }
  }

  static void _validatePoint(GpsPoint point) {
    if (!point.latitude.isFinite ||
        point.latitude < -90 ||
        point.latitude > 90) {
      throw ArgumentError.value(
        point.latitude,
        'latitude',
        'Must be between -90 and 90.',
      );
    }

    if (!point.longitude.isFinite ||
        point.longitude < -180 ||
        point.longitude > 180) {
      throw ArgumentError.value(
        point.longitude,
        'longitude',
        'Must be between -180 and 180.',
      );
    }

    if (point.timestampMs < 0) {
      throw ArgumentError.value(
        point.timestampMs,
        'timestampMs',
        'Cannot be negative.',
      );
    }
  }

  static double _distanceMeters(GpsPoint from, GpsPoint to) {
    const earthRadiusMeters = 6371000.0;

    final lat1 = _toRadians(from.latitude);
    final lat2 = _toRadians(to.latitude);

    final deltaLat = _toRadians(to.latitude - from.latitude);
    final deltaLng = _toRadians(to.longitude - from.longitude);

    final a = math.sin(deltaLat / 2) * math.sin(deltaLat / 2) +
        math.cos(lat1) *
            math.cos(lat2) *
            math.sin(deltaLng / 2) *
            math.sin(deltaLng / 2);

    final clampedA = a.clamp(0.0, 1.0);
    final c = 2 * math.atan2(
      math.sqrt(clampedA),
      math.sqrt(1 - clampedA),
    );

    return earthRadiusMeters * c;
  }

  static double _toRadians(double degrees) {
    return degrees * math.pi / 180.0;
  }
}

class GpsCompressionStats {
  int originalPoints = 0;
  int compressedPoints = 0;
  int totalOriginalBytes = 0;
  int totalCompressedBytes = 0;

  double get compressionRatio {
    if (totalOriginalBytes <= 0) return 0;

    return (1 - totalCompressedBytes / totalOriginalBytes) * 100;
  }

  int get pointsSaved => originalPoints - compressedPoints;

  void reset() {
    originalPoints = 0;
    compressedPoints = 0;
    totalOriginalBytes = 0;
    totalCompressedBytes = 0;
  }
}

